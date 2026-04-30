import request from 'supertest';
import { prisma } from '@common/db/prisma';
import { redis } from '@common/db/redis';
import { app as contentApp } from '../../../content/src/index';
import { app as authApp } from '../../../auth/src/index';
import { app as socialApp } from '../../../social/src/index';

const contentRequest = process.env.CONTENT_URL || contentApp;
const authRequest = process.env.AUTH_URL || authApp;
const socialRequest = process.env.SOCIAL_URL || socialApp;

interface TestUser {
  id: string;
  token: string;
  username: string;
}

describe('Feed Privacy and Blocking Integration Tests', () => {
  const users: TestUser[] = [];
  const password = 'Password123!';

  // Helper to create user and get token
  async function createUser(email: string, username: string, isPrivate = false) {
    const signupRes = await request(authRequest)
      .post('/identity/auth/signup')
      .send({ email, password });

    const loginRes = await request(authRequest)
      .post('/identity/auth/login')
      .send({ email, password });

    const token = loginRes.body.token;
    const userId = signupRes.body.id;

    await prisma.user.update({
      where: { id: userId },
      data: { username, isPrivate },
    });

    return { id: userId, token, username };
  }

  beforeAll(async () => {
    await prisma.$connect();

    // Create 4 users for different scenarios
    // 1. Blocker (Maya)
    // 2. Blocked (Noah)
    // 3. Private Account (Priya)
    // 4. Public Account (Liam)
    users.push(await createUser(`maya-${Date.now()}@test.com`, `maya_${Date.now()}`));
    users.push(await createUser(`noah-${Date.now()}@test.com`, `noah_${Date.now()}`));
    users.push(await createUser(`priya-${Date.now()}@test.com`, `priya_${Date.now()}`, true));
    users.push(await createUser(`liam-${Date.now()}@test.com`, `liam_${Date.now()}`));
  });

  afterAll(async () => {
    const userIds = users.map((u) => u.id);
    await prisma.post.deleteMany({ where: { authorId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    await redis.quit();
  });

  it('should setup posts for various scenarios', async () => {
    // Maya's posts
    await request(contentRequest)
      .post('/content/posts')
      .set('Authorization', `Bearer ${users[0].token}`)
      .send({ content: 'Maya public post', visibility: 'public' });

    await request(contentRequest)
      .post('/content/posts')
      .set('Authorization', `Bearer ${users[0].token}`)
      .send({ content: 'Maya private post', visibility: 'private' });

    // Noah's posts
    await request(contentRequest)
      .post('/content/posts')
      .set('Authorization', `Bearer ${users[1].token}`)
      .send({ content: 'Noah public post', visibility: 'public' });

    // Priya's posts (Private account)
    await request(contentRequest)
      .post('/content/posts')
      .set('Authorization', `Bearer ${users[2].token}`)
      .send({ content: 'Priya followers post', visibility: 'followers' });

    await request(contentRequest)
      .post('/content/posts')
      .set('Authorization', `Bearer ${users[2].token}`)
      .send({ content: 'Priya public post', visibility: 'public' });

    // Liam's posts
    await request(contentRequest)
      .post('/content/posts')
      .set('Authorization', `Bearer ${users[3].token}`)
      .send({ content: 'Liam public post', visibility: 'public' });
  });

  describe('Privacy Logic', () => {
    it('should show own private posts in own feed', async () => {
      const res = await request(contentRequest)
        .get('/content/feed')
        .set('Authorization', `Bearer ${users[0].token}`);

      expect(res.status).toBe(200);
      const contents = res.body.map((p: { content: string }) => p.content);
      expect(contents).toContain('Maya public post');
      expect(contents).toContain('Maya private post');
    });

    it('should NOT show public posts from private accounts to non-followers', async () => {
      // Liam looking at feed (not following Priya)
      const res = await request(contentRequest)
        .get('/content/feed')
        .set('Authorization', `Bearer ${users[3].token}`);

      const contents = res.body.map((p: { content: string }) => p.content);
      expect(contents).not.toContain('Priya public post');
      expect(contents).not.toContain('Priya followers post');
    });

    it('should show public and followers posts from private accounts to followers', async () => {
      // Liam follows Priya
      await request(socialRequest)
        .put(`/social/${users[2].id}/follow`)
        .set('Authorization', `Bearer ${users[3].token}`);

      const res = await request(contentRequest)
        .get('/content/feed')
        .set('Authorization', `Bearer ${users[3].token}`);

      const contents = res.body.map((p: { content: string }) => p.content);
      expect(contents).toContain('Priya public post');
      expect(contents).toContain('Priya followers post');
    });
  });

  describe('Blocking Logic', () => {
    it('should hide posts from users the requester has blocked', async () => {
      // Maya blocks Noah
      await request(socialRequest)
        .put(`/social/${users[1].id}/block`)
        .set('Authorization', `Bearer ${users[0].token}`);

      const res = await request(contentRequest)
        .get('/content/feed')
        .set('Authorization', `Bearer ${users[0].token}`);

      const contents = res.body.map((p: { content: string }) => p.content);
      expect(contents).not.toContain('Noah public post');
    });

    it('should hide posts from users who have blocked the requester', async () => {
      // Noah looking at feed, should not see Maya's posts because Maya blocked him
      const res = await request(contentRequest)
        .get('/content/feed')
        .set('Authorization', `Bearer ${users[1].token}`);

      const contents = res.body.map((p: { content: string }) => p.content);
      expect(contents).not.toContain('Maya public post');
    });

    it('should restore visibility after unblocking', async () => {
      // Maya unblocks Noah
      await request(socialRequest)
        .delete(`/social/${users[1].id}/block`)
        .set('Authorization', `Bearer ${users[0].token}`);

      const res = await request(contentRequest)
        .get('/content/feed')
        .set('Authorization', `Bearer ${users[0].token}`);

      const contents = res.body.map((p: { content: string }) => p.content);
      expect(contents).toContain('Noah public post');
    });
  });

  describe('Single Post Visibility', () => {
    let mayaPostId: string;
    let priyaPostId: string;

    beforeAll(async () => {
      const mayaRes = await request(contentRequest)
        .post('/content/posts')
        .set('Authorization', `Bearer ${users[0].token}`)
        .send({ content: 'Maya target post', visibility: 'public' });
      mayaPostId = mayaRes.body.id;

      const priyaRes = await request(contentRequest)
        .post('/content/posts')
        .set('Authorization', `Bearer ${users[2].token}`)
        .send({ content: 'Priya target post', visibility: 'followers' });
      priyaPostId = priyaRes.body.id;
    });

    it('should allow guest to see public post from public account', async () => {
      const res = await request(contentRequest).get(`/content/posts/${mayaPostId}`);
      expect(res.status).toBe(200);
    });

    it('should forbid guest from seeing public post from private account', async () => {
      // Priya is private
      const publicPriyaPostRes = await request(contentRequest)
        .post('/content/posts')
        .set('Authorization', `Bearer ${users[2].token}`)
        .send({ content: 'Priya public but private account', visibility: 'public' });

      const res = await request(contentRequest).get(`/content/posts/${publicPriyaPostRes.body.id}`);
      expect(res.status).toBe(403);
    });

    it('should forbid non-follower from seeing followers-only post', async () => {
      // Noah is not following Priya
      const res = await request(contentRequest)
        .get(`/content/posts/${priyaPostId}`)
        .set('Authorization', `Bearer ${users[1].token}`);
      expect(res.status).toBe(403);
    });

    it('should forbid blocked user from seeing any post from blocker', async () => {
      // Maya blocks Noah
      await request(socialRequest)
        .put(`/social/${users[1].id}/block`)
        .set('Authorization', `Bearer ${users[0].token}`);

      const res = await request(contentRequest)
        .get(`/content/posts/${mayaPostId}`)
        .set('Authorization', `Bearer ${users[1].token}`);
      expect(res.status).toBe(403);
    });
  });
});
