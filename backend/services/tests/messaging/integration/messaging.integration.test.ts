import request from 'supertest';
import { prisma } from '@common/db/prisma';
import { redis } from '@common/db/redis';

// Auth app for creating tokens, Messaging app as the target
import { app as authApp } from '@auth/index';
import { app as messagingApp } from '@messaging/index';

const authTarget = process.env.AUTH_URL || authApp;
const messagingTarget = process.env.MESSAGING_URL || messagingApp;

describe('Messaging Integration Tests', () => {
  let userAToken: string;
  let userBToken: string;
  let userAId: string;
  let userBId: string;
  let conversationId: string;
  let messageId: string;

  const userAEmail = `msg-a-${Date.now()}@example.com`;
  const userBEmail = `msg-b-${Date.now()}@example.com`;

  beforeAll(async () => {
    await prisma.$connect();

    // Signup User A
    const signupA = await request(authTarget)
      .post('/identity/auth/signup')
      .send({ email: userAEmail, password: 'password123' });
    userAId = signupA.body.id;

    // Login User A
    const loginA = await request(authTarget)
      .post('/identity/auth/login')
      .send({ email: userAEmail, password: 'password123' });
    userAToken = loginA.body.token;

    // Signup User B
    const signupB = await request(authTarget)
      .post('/identity/auth/signup')
      .send({ email: userBEmail, password: 'password123' });
    userBId = signupB.body.id;

    // Login User B
    const loginB = await request(authTarget)
      .post('/identity/auth/login')
      .send({ email: userBEmail, password: 'password123' });
    userBToken = loginB.body.token;
  });

  afterAll(async () => {
    // Cleanup - cascade deletes handle conversations, participants, messages
    await prisma.user.deleteMany({
      where: { email: { contains: '@example.com' } },
    });
    await prisma.$disconnect();
    await redis.quit();
  });

  it('should reject unauthenticated requests', async () => {
    const res = await request(messagingTarget).get('/messaging/conversations');
    expect(res.status).toBe(401);
  });

  it('should return empty list for a new user with no conversations', async () => {
    const res = await request(messagingTarget)
      .get('/messaging/conversations')
      .set('Authorization', `Bearer ${userAToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('should create a direct conversation', async () => {
    const res = await request(messagingTarget)
      .post('/messaging/conversations/direct')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ targetUserId: userBId });

    expect(res.status).toBe(200);
    expect(res.body.type).toBe('direct');
    expect(res.body.participants.length).toBe(2);
    conversationId = res.body.id;
  });

  it('should return the same conversation if started again (idempotent)', async () => {
    const res = await request(messagingTarget)
      .post('/messaging/conversations/direct')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ targetUserId: userBId });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(conversationId);
  });

  it('should return 400 when messaging yourself', async () => {
    const res = await request(messagingTarget)
      .post('/messaging/conversations/direct')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ targetUserId: userAId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CANNOT_MESSAGE_SELF');
  });

  it('should send a message to the conversation', async () => {
    const res = await request(messagingTarget)
      .post(`/messaging/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ content: 'Hey there!' });

    expect(res.status).toBe(201);
    expect(res.body.content).toBe('Hey there!');
    messageId = res.body.id;
  });

  it('should list messages in the conversation', async () => {
    const res = await request(messagingTarget)
      .get(`/messaging/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${userAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.messages.length).toBeGreaterThan(0);
  });

  it('should return 400 when sending an empty message', async () => {
    const res = await request(messagingTarget)
      .post(`/messaging/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ content: '' });

    expect(res.status).toBe(400);
  });

  it('should mark conversation as read', async () => {
    const res = await request(messagingTarget)
      .put(`/messaging/conversations/${conversationId}/read`)
      .set('Authorization', `Bearer ${userBToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should return 403 when a non-participant tries to message', async () => {
    const outsiderEmail = `outsider-${Date.now()}@example.com`;
    await request(authTarget)
      .post('/identity/auth/signup')
      .send({ email: outsiderEmail, password: 'password123' });

    const outsiderLogin = await request(authTarget)
      .post('/identity/auth/login')
      .send({ email: outsiderEmail, password: 'password123' });

    const res = await request(messagingTarget)
      .post(`/messaging/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${outsiderLogin.body.token}`)
      .send({ content: 'Infiltrating!' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_A_PARTICIPANT');
  });

  it('should return 401 when a deleted user tries to message', async () => {
    const deletedEmail = `deleted-${Date.now()}@example.com`;
    const signup = await request(authTarget)
      .post('/identity/auth/signup')
      .send({ email: deletedEmail, password: 'password123' });

    const login = await request(authTarget)
      .post('/identity/auth/login')
      .send({ email: deletedEmail, password: 'password123' });

    await prisma.user.delete({ where: { id: signup.body.id } });

    const res = await request(messagingTarget)
      .post(`/messaging/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ content: 'Ghost messaging!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('USER_REMOVED');
  });

  it('should soft-delete a message', async () => {
    const res = await request(messagingTarget)
      .delete(`/messaging/conversations/${conversationId}/messages/${messageId}`)
      .set('Authorization', `Bearer ${userAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should return 403 when deleting another users message', async () => {
    const sendRes = await request(messagingTarget)
      .post(`/messaging/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${userBToken}`)
      .send({ content: 'From B' });

    const bMessageId = sendRes.body.id;

    const deleteRes = await request(messagingTarget)
      .delete(`/messaging/conversations/${conversationId}/messages/${bMessageId}`)
      .set('Authorization', `Bearer ${userAToken}`);

    expect(deleteRes.status).toBe(403);
    expect(deleteRes.body.error).toBe('FORBIDDEN');
  });

  it('should send an encrypted message', async () => {
    const res = await request(messagingTarget)
      .post(`/messaging/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${userAToken}`)
      .send({ content: 'ENCRYPTED_BLOB', isEncrypted: true, encryptionHeader: 'HEADER_DATA' });

    expect(res.status).toBe(201);
    expect(res.body.content).toBe('ENCRYPTED_BLOB');
    expect(res.body.isEncrypted).toBe(true);
    expect(res.body.encryptionHeader).toBe('HEADER_DATA');
  });

  it('should allow a global admin to delete another users message', async () => {
    // 1. Create an admin user
    const adminEmail = `admin-${Date.now()}@example.com`;
    const signupAdmin = await request(authTarget)
      .post('/identity/auth/signup')
      .send({ email: adminEmail, password: 'password123' });

    // Promote to admin directly in db
    await prisma.user.update({
      where: { id: signupAdmin.body.id },
      data: { role: 'admin' },
    });

    const loginAdmin = await request(authTarget)
      .post('/identity/auth/login')
      .send({ email: adminEmail, password: 'password123' });

    // 2. User B sends a message
    const sendRes = await request(messagingTarget)
      .post(`/messaging/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${userBToken}`)
      .send({ content: 'I am bad' });
    const bMessageId = sendRes.body.id;

    // 3. Admin deletes the message
    const deleteRes = await request(messagingTarget)
      .delete(`/messaging/conversations/${conversationId}/messages/${bMessageId}`)
      .set('Authorization', `Bearer ${loginAdmin.body.token}`);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);
  });
});
