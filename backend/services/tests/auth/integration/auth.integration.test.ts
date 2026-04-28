import request from 'supertest';
import { prisma } from '@common/db/prisma';
import { redis } from '@common/db/redis';

import { app } from '@auth/index';

// We hit the live running server if API_URL is provided, otherwise we use the Express app (ghost server)
const requestTarget = process.env.API_URL || app;

describe('Auth Integration Tests (Live Server)', () => {
  const testEmail = `test-${Date.now()}@example.com`;
  const testPassword = 'password123';
  let token: string;
  let userId: string;

  beforeAll(async () => {
    // Wait for DB/Redis connection if needed
    await prisma.$connect();
  });

  afterAll(async () => {
    // Cleanup all test users
    await prisma.user.deleteMany({
      where: { email: { contains: '@example.com' } },
    });
    await prisma.$disconnect();
    await redis.quit();
  });

  it('should sign up a new user', async () => {
    const res = await request(requestTarget)
      .post('/identity/auth/signup')
      .send({ email: testEmail, password: testPassword });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe(testEmail);
    userId = res.body.id;
  });

  it('should login and get a token', async () => {
    const res = await request(requestTarget)
      .post('/identity/auth/login')
      .send({ email: testEmail, password: testPassword });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    token = res.body.token;
  });

  it('should set a username and verify the history table works', async () => {
    // 1. Set first username
    const res1 = await request(requestTarget)
      .put('/identity/profile/me/username')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'integration_tester_1' });

    expect(res1.status).toBe(200);

    // 2. Bypass cooldown manually in DB to allow a second change
    await prisma.user.update({
      where: { id: userId },
      data: {
        usernameLastChangedAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000),
      },
    });

    // 3. Set second username
    const res2 = await request(requestTarget)
      .put('/identity/profile/me/username')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'integration_tester_2' });

    expect(res2.status).toBe(200);

    // 4. VERIFY THE USERNAME HISTORY TABLE
    const history = await prisma.usernameHistory.findMany({
      where: { userId },
    });

    expect(history.length).toBe(1);
    expect(history[0].oldUsername).toBe('integration_tester_1');
  });

  it('should return 403 when logging in as a soft-deleted user', async () => {
    // 1. Signup a user
    const email = `deleted-${Date.now()}@example.com`;
    const signupRes = await request(requestTarget)
      .post('/identity/auth/signup')
      .send({ email, password: 'password123' });
    const localUserId = signupRes.body.id;

    // 2. Soft-delete the user in the DB
    await prisma.user.update({
      where: { id: localUserId },
      data: { deletedAt: new Date() },
    });

    // 3. Try to login
    const res = await request(requestTarget)
      .post('/identity/auth/login')
      .send({ email, password: 'password123' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('ACCOUNT_DELETED');

    // Cleanup
    await prisma.user.delete({ where: { id: localUserId } });
  });
});
