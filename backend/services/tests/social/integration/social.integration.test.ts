/* eslint-disable @typescript-eslint/no-explicit-any */
import request from 'supertest';
import { prisma } from '@common/db/prisma';
import { redis } from '@common/db/redis';
import { app as authApp } from '@auth/index';
import { app as socialApp } from '@social/index';
import { app as messagingApp } from '@messaging/index';

const authTarget = process.env.AUTH_URL || authApp;
const socialTarget = process.env.SOCIAL_URL || socialApp;
const messagingTarget = process.env.MESSAGING_URL || messagingApp;

describe('Social Integration Tests', () => {
  let userA: any, userB: any;
  let tokenA: string, tokenB: string;

  beforeAll(async () => {
    await prisma.$connect();

    const signup = async (email: string) => {
      const s = await request(authTarget)
        .post('/identity/auth/signup')
        .send({ email, password: 'password123' });
      const l = await request(authTarget)
        .post('/identity/auth/login')
        .send({ email, password: 'password123' });
      return { id: s.body.id, token: l.body.token };
    };

    userA = await signup(`social-a-${Date.now()}@example.com`);
    userB = await signup(`social-b-${Date.now()}@example.com`);
    tokenA = userA.token;
    tokenB = userB.token;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: '@example.com' } } });
    await prisma.$disconnect();
    await redis.quit();
  });

  it('should follow and unfollow a user', async () => {
    // Follow
    const followRes = await request(socialTarget)
      .put(`/social/${userB.id}/follow`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(followRes.status).toBe(200);

    // Check status
    const statusRes = await request(socialTarget)
      .get(`/social/${userB.id}/status`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(statusRes.body.isFollowing).toBe(true);

    // Unfollow
    const unfollowRes = await request(socialTarget)
      .delete(`/social/${userB.id}/follow`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(unfollowRes.status).toBe(200);

    const statusRes2 = await request(socialTarget)
      .get(`/social/${userB.id}/status`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(statusRes2.body.isFollowing).toBe(false);
  });

  it('should detect mutual follows as friends', async () => {
    // A follows B
    await request(socialTarget)
      .put(`/social/${userB.id}/follow`)
      .set('Authorization', `Bearer ${tokenA}`);
    // B follows A
    await request(socialTarget)
      .put(`/social/${userA.id}/follow`)
      .set('Authorization', `Bearer ${tokenB}`);

    const statusRes = await request(socialTarget)
      .get(`/social/${userB.id}/status`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(statusRes.body.isFriend).toBe(true);
  });

  it('should block a user and remove follows', async () => {
    // A blocks B
    const blockRes = await request(socialTarget)
      .put(`/social/${userB.id}/block`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(blockRes.status).toBe(200);

    // Check status
    const statusRes = await request(socialTarget)
      .get(`/social/${userB.id}/status`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(statusRes.body.isBlocking).toBe(true);
    expect(statusRes.body.isFollowing).toBe(false); // Follow should be removed
    expect(statusRes.body.isFriend).toBe(false);
  });

  it('should prevent following a blocked user', async () => {
    const res = await request(socialTarget)
      .put(`/social/${userB.id}/follow`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(403); // Should fail because B is blocked by A
  });

  it('should prevent sending a message to a blocked user', async () => {
    // A blocks B
    await request(socialTarget)
      .put(`/social/${userB.id}/block`)
      .set('Authorization', `Bearer ${tokenA}`);

    // Try to send a message from A to B
    const sendRes = await request(messagingTarget)
      .post(`/messaging/conversations/direct`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ targetUserId: userB.id });

    expect(sendRes.status).toBe(403); // Should fail because B is blocked by A
  });

  it('should prevent sending a message from a blocked user', async () => {
    // A blocks B (so B cannot message A)
    await request(socialTarget)
      .put(`/social/${userB.id}/block`)
      .set('Authorization', `Bearer ${tokenA}`);

    // Try to send a message from B to A
    const sendRes = await request(messagingTarget)
      .post(`/messaging/conversations/direct`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ targetUserId: userA.id });

    expect(sendRes.status).toBe(403); // Should fail because B is blocked by A
  });

  it('should unblock a user and allow messaging again', async () => {
    // A unblocks B
    const unblockRes = await request(socialTarget)
      .delete(`/social/${userB.id}/block`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(unblockRes.status).toBe(200);

    // Messaging should work now
    const sendRes = await request(messagingTarget)
      .post(`/messaging/conversations/direct`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ targetUserId: userB.id });
    expect(sendRes.status).toBe(200);
  });
});
