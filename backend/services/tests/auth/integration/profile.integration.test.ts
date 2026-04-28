import request from 'supertest';
import { prisma } from '@auth/db/prisma';
import { redis } from '@auth/db/redis';
import { app } from '@auth/index';

const requestTarget = process.env.API_URL || app;

describe('Profile Integration Tests', () => {
  const testEmail = `profile-${Date.now()}@example.com`;
  const testPassword = 'password123';
  let token: string;
  let userId: string;
  let username: string;

  beforeAll(async () => {
    await prisma.$connect();
    // Setup test user
    await request(requestTarget)
      .post('/api/v1/auth/signup')
      .send({ email: testEmail, password: testPassword });

    const loginRes = await request(requestTarget)
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword });

    token = loginRes.body.token;
    userId = loginRes.body.user.id;
    username = `tester_${Date.now()}`;

    // Set username so we can test public profile
    await request(requestTarget)
      .put('/api/v1/users/me/username')
      .set('Authorization', `Bearer ${token}`)
      .send({ username });
  });

  afterAll(async () => {
    // Cleanup
    if (userId) {
      await prisma.usernameHistory.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
    await redis.quit();
  });

  it('should update profile fields', async () => {
    const res = await request(requestTarget)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        displayName: 'Integration Tester',
        bio: 'Testing profile routes',
      });

    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('Integration Tester');
    expect(res.body.bio).toBe('Testing profile routes');
  });

  it('should get public profile with full details if public', async () => {
    const res = await request(requestTarget).get(`/api/v1/users/${username}`);

    expect(res.status).toBe(200);
    expect(res.body.username).toBe(username);
    expect(res.body.displayName).toBe('Integration Tester');
    expect(res.body.bio).toBe('Testing profile routes');
  });

  it('should update privacy settings', async () => {
    const res = await request(requestTarget)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ isPrivate: true });

    expect(res.status).toBe(200);
    expect(res.body.isPrivate).toBe(true);
  });

  it('should hide private details in public profile', async () => {
    const res = await request(requestTarget).get(`/api/v1/users/${username}`);

    expect(res.status).toBe(200);
    expect(res.body.isPrivate).toBe(true);
    expect(res.body.displayName).toBe('Integration Tester');
    expect(res.body.bio).toBeUndefined(); // Hidden
  });

  it('should enable 2FA and return a secret', async () => {
    const res = await request(requestTarget)
      .post('/api/v1/users/me/2fa/enable')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.secret).toBeDefined();
  });
});
