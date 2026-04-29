import request from 'supertest';
import { prisma } from '@common/db/prisma';
import { redis } from '@common/db/redis';
import { app as contentApp } from '../../../content/src/index';
import { app as authApp } from '../../../auth/src/index';

const contentRequest = process.env.CONTENT_URL || contentApp;
const authRequest = process.env.AUTH_URL || authApp;

describe('Content Integration Tests', () => {
  const testEmail = `content-test-${Date.now()}@example.com`;
  const testPassword = 'Password123!';
  let token: string;
  let userId: string;
  let postId: string;

  beforeAll(async () => {
    await prisma.$connect();

    // 1. Create a user for testing
    const signupRes = await request(authRequest)
      .post('/identity/auth/signup')
      .send({ email: testEmail, password: testPassword });
    userId = signupRes.body.id;

    // 2. Login to get token
    const loginRes = await request(authRequest)
      .post('/identity/auth/login')
      .send({ email: testEmail, password: testPassword });
    token = loginRes.body.token;

    // 3. Ensure user has a username (required for some responses)
    await prisma.user.update({
      where: { id: userId },
      data: { username: `testuser_${Date.now()}` },
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await prisma.$disconnect();
    await redis.quit();
  });

  describe('POST /content/posts', () => {
    it('should create a post with media', async () => {
      const res = await request(contentRequest)
        .post('/content/posts')
        .set('Authorization', `Bearer ${token}`)
        .send({
          content: 'Integration test post with media',
          visibility: 'public',
          media: [{ type: 'image', url: 'https://example.com/test.jpg' }],
        });

      expect(res.status).toBe(201);
      expect(res.body.content).toBe('Integration test post with media');
      expect(res.body.media).toHaveLength(1);
      postId = res.body.id;
    });

    it('should return 401 if not authenticated', async () => {
      const res = await request(contentRequest)
        .post('/content/posts')
        .send({ content: 'Unauthenticated' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /content/posts/:id', () => {
    it('should retrieve a post with its stats', async () => {
      const res = await request(contentRequest).get(`/content/posts/${postId}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(postId);
      expect(res.body).toHaveProperty('_count');
    });

    it('should return 404 for non-existent post', async () => {
      const res = await request(contentRequest).get(
        '/content/posts/00000000-0000-0000-0000-000000000000',
      );
      expect(res.status).toBe(404);
    });
  });

  describe('Engagement: Likes and Comments', () => {
    it('should like a post', async () => {
      const res = await request(contentRequest)
        .post(`/content/posts/${postId}/like`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);

      const post = await request(contentRequest).get(`/content/posts/${postId}`);
      expect(post.body._count.likes).toBe(1);
    });

    it('should comment on a post', async () => {
      const res = await request(contentRequest)
        .post(`/content/posts/${postId}/comments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'Test comment' });

      expect(res.status).toBe(201);
      expect(res.body.content).toBe('Test comment');

      const post = await request(contentRequest).get(`/content/posts/${postId}`);
      expect(post.body._count.comments).toBe(1);
    });
  });

  describe('DELETE /content/posts/:id', () => {
    it('should prevent others from deleting a post', async () => {
      // 1. Create another user
      const otherUserEmail = `other-${Date.now()}@example.com`;
      await request(authRequest)
        .post('/identity/auth/signup')
        .send({ email: otherUserEmail, password: testPassword });

      const otherLogin = await request(authRequest)
        .post('/identity/auth/login')
        .send({ email: otherUserEmail, password: testPassword });

      // 2. Try to delete Maya's post with Other's token
      const res = await request(contentRequest)
        .delete(`/content/posts/${postId}`)
        .set('Authorization', `Bearer ${otherLogin.body.token}`);

      expect(res.status).toBe(403);

      // Cleanup other user
      await prisma.user.delete({ where: { email: otherUserEmail } });
    });

    it('should allow author to delete post', async () => {
      const res = await request(contentRequest)
        .delete(`/content/posts/${postId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);

      const check = await request(contentRequest).get(`/content/posts/${postId}`);
      expect(check.status).toBe(404);
    });
  });
});
