/* eslint-disable @typescript-eslint/no-explicit-any */
import request from 'supertest';
import { prisma } from '@common/db/prisma';
import { redis } from '@common/db/redis';
import { app as messagingApp } from '../../../messaging/src';
import { app as authApp } from '../../../auth/src';

interface TestUser {
  id: string;
  token: string;
  email: string;
}

describe('Messaging Edge Integration Tests', () => {
  let userA: TestUser, userB: TestUser, userC: TestUser;
  let authTarget: any;
  let messagingTarget: any;

  beforeAll(async () => {
    authTarget = authApp;
    messagingTarget = messagingApp;

    // Create 3 users
    const signup = async (email: string) => {
      const res = await request(authTarget)
        .post('/identity/auth/signup')
        .send({ email, password: 'password123' });
      const login = await request(authTarget)
        .post('/identity/auth/login')
        .send({ email, password: 'password123' });
      return { id: res.body.id, token: login.body.token, email };
    };

    userA = await signup(`usera-${Date.now()}@test.com`);
    userB = await signup(`userb-${Date.now()}@test.com`);
    userC = await signup(`userc-${Date.now()}@test.com`);
  });

  afterAll(async () => {
    // Aggressive cleanup for all test data
    await prisma.message.deleteMany();
    await prisma.conversationParticipant.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.user.deleteMany({
      where: {
        OR: [{ email: { contains: '@test.com' } }, { email: { contains: '@example.com' } }],
      },
    });
    await prisma.$disconnect();
    await redis.quit();
  });

  describe('Group Management Lifecycle', () => {
    let groupId: string;

    it('should create a group and manage participants', async () => {
      // 1. Create group with A and B
      const createRes = await request(messagingTarget)
        .post('/messaging/conversations/group')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ title: 'Edge Group', memberIds: [userB.id] });

      expect(createRes.status).toBe(201);
      groupId = createRes.body.id;

      // 2. Add C to group (A is admin)
      const addRes = await request(messagingTarget)
        .post(`/messaging/conversations/${groupId}/participants`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ targetUserId: userC.id });
      expect(addRes.status).toBe(200);

      // 3. Promote C to admin
      const promoteRes = await request(messagingTarget)
        .put(`/messaging/conversations/${groupId}/participants/${userC.id}/role`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ role: 'admin' });
      expect(promoteRes.status).toBe(200);

      // 4. B tries to promote self (fails, not admin)
      const failPromote = await request(messagingTarget)
        .put(`/messaging/conversations/${groupId}/participants/${userB.id}/role`)
        .set('Authorization', `Bearer ${userB.token}`)
        .send({ role: 'admin' });
      expect(failPromote.status).toBe(403);

      // 5. C (now admin) removes B
      const removeRes = await request(messagingTarget)
        .delete(`/messaging/conversations/${groupId}/participants/${userB.id}`)
        .set('Authorization', `Bearer ${userC.token}`);
      expect(removeRes.status).toBe(200);

      // 6. C tries to demote A (C is admin, A is admin - this should work)
      const demoteRes = await request(messagingTarget)
        .put(`/messaging/conversations/${groupId}/participants/${userA.id}/role`)
        .set('Authorization', `Bearer ${userC.token}`)
        .send({ role: 'member' });
      expect(demoteRes.status).toBe(200);

      // 7. C tries to demote self (fails, last admin)
      const failDemote = await request(messagingTarget)
        .put(`/messaging/conversations/${groupId}/participants/${userC.id}/role`)
        .set('Authorization', `Bearer ${userC.token}`)
        .send({ role: 'member' });
      expect(failDemote.status).toBe(400);
      expect(failDemote.body.error).toBe('CANNOT_DEMOTE_LAST_ADMIN');
    });

    it('should handle message limits and pagination edge cases', async () => {
      // Create 5 messages
      for (let i = 0; i < 5; i++) {
        await request(messagingTarget)
          .post(`/messaging/conversations/${groupId}/messages`)
          .set('Authorization', `Bearer ${userA.token}`)
          .send({ content: `Message ${i}` });
      }

      // Fetch with limit 2
      const res1 = await request(messagingTarget)
        .get(`/messaging/conversations/${groupId}/messages?limit=2`)
        .set('Authorization', `Bearer ${userA.token}`);

      expect(res1.body.messages).toHaveLength(2);
      expect(res1.body.nextCursor).toBeDefined();

      // Fetch next page
      const res2 = await request(messagingTarget)
        .get(`/messaging/conversations/${groupId}/messages?limit=2&cursor=${res1.body.nextCursor}`)
        .set('Authorization', `Bearer ${userA.token}`);

      expect(res2.body.messages).toHaveLength(2);
      expect(res2.body.messages[0].content).not.toBe(res1.body.messages[0].content);
    });
  });
});
