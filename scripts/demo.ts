import * as crypto from 'crypto';
import { io, type Socket } from 'socket.io-client';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const AUTH_URL = process.env.AUTH_URL || `http://localhost:${process.env.PORT || 8080}`;
const SOCIAL_URL = process.env.SOCIAL_URL || `http://localhost:${process.env.SOCIAL_PORT || 8082}`;
const MESSAGING_URL =
  process.env.MESSAGING_URL || `http://localhost:${process.env.MESSAGING_PORT || 8081}`;
const GATEWAY_URL =
  process.env.GATEWAY_URL || `http://localhost:${process.env.GATEWAY_PORT || 8083}`;
const CONTENT_URL =
  process.env.CONTENT_URL || `http://localhost:${process.env.CONTENT_PORT || 8084}`;

const PASSWORD = 'password123';
const PACKET_KEY_INFO = 'chatognito.gateway.packet.v1';
const HANDSHAKE_PROOF_EVENT = 'security:handshake:ack';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type GatewayAck<TData = unknown> =
  | { ok: true; data: TData }
  | { ok: false; error: { code: string; message: string } };

interface DemoUserInput {
  label: string;
  email: string;
  username: string;
  displayName: string;
  bio: string;
  isPrivate?: boolean;
}

interface DemoUserSession extends DemoUserInput {
  id: string;
  token: string;
  keys?: DemoKeyMaterial;
}

interface ApiOptions {
  method?: HttpMethod;
  token?: string;
  body?: unknown;
  expectedStatuses?: number[];
}

interface LoginResponse {
  token: string;
  user: {
    id: string;
    email: string;
    username: string | null;
  };
}

interface Conversation {
  id: string;
  type: 'direct' | 'group';
  title?: string | null;
}

interface Message {
  id: string;
  content: string;
  isEncrypted?: boolean;
  encryptionHeader?: string | null;
}

interface DemoPost {
  id: string;
  content: string;
  visibility: string;
  _count: {
    likes: number;
    comments: number;
  };
}

interface DemoComment {
  id: string;
  content: string;
}

interface SecurityHandshakePayload {
  serverPublicKey: string;
  challenge: string;
}

interface SignedSocketPacket<TData> {
  nonce: string;
  timestamp: number;
  data: TData;
  signature: string;
}

interface PresenceStatus {
  userId: string;
  online: boolean;
  lastSeenAt: string | null;
}

interface SecureSocketSession {
  user: DemoUserSession;
  socket: Socket;
  packetKey: Buffer;
  events: {
    messages: unknown[];
    presence: PresenceStatus[];
    reads: unknown[];
  };
}

interface KeyPair {
  public: string;
  private: string;
}

interface DemoKeyMaterial {
  identityDh: KeyPair;
  identitySigning: KeyPair;
  signedPreKey: KeyPair;
  oneTimePreKeys: KeyPair[];
}

interface EncryptedPayload {
  plaintext: string;
  ciphertext: string;
  encryptionHeader: string;
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

function printHelp() {
  console.log(`Chatognito live demo scenario

Runs against your local services by API/socket calls only.

Required services:
  Auth       ${AUTH_URL}
  Social     ${SOCIAL_URL}
  Messaging  ${MESSAGING_URL}
  Gateway    ${GATEWAY_URL}
  Content    ${CONTENT_URL}

Usage:
  npm run db:seed
  npm run demo:scenario

Optional env:
  DEMO_SEED_SUFFIX=myrun
  AUTH_URL=http://localhost:8080
  SOCIAL_URL=http://localhost:8082
  MESSAGING_URL=http://localhost:8081
  GATEWAY_URL=http://localhost:8083
`);
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  const suffix = (process.env.DEMO_SEED_SUFFIX || Date.now().toString(36).slice(-6)).toLowerCase();
  const users = buildDemoUsers(suffix);
  const overview: string[] = [];

  console.log('\nChatognito live scenario starting...');
  console.log(`Scenario suffix: ${suffix}`);
  console.log(`Auth: ${AUTH_URL}`);
  console.log(`Social: ${SOCIAL_URL}`);
  console.log(`Messaging: ${MESSAGING_URL}`);
  console.log(`Gateway: ${GATEWAY_URL}`);
  console.log(`Content: ${CONTENT_URL}`);

  await healthCheck();

  const [maya, noah, priya] = await onboardUsers(users, overview);
  await registerKeyBundles([maya, noah, priya], overview);

  await identityAndProfileTour(maya, priya, suffix, overview);
  await socialTour(maya, noah, priya, overview);
  const directConversation = await messagingTour(maya, noah, priya, overview);
  await gatewayTour(maya, noah, directConversation.id, overview);
  await contentTour(maya, noah, overview);

  printOverview(overview);
}

function buildDemoUsers(suffix: string): DemoUserInput[] {
  return [
    {
      label: 'Maya',
      email: `maya.${suffix}@demo.chatognito.local`,
      username: `maya_${suffix}`.slice(0, 20),
      displayName: 'Maya Demo',
      bio: 'Joined Chatognito to test friends, DMs, and realtime presence.',
    },
    {
      label: 'Noah',
      email: `noah.${suffix}@demo.chatognito.local`,
      username: `noah_${suffix}`.slice(0, 20),
      displayName: 'Noah Demo',
      bio: 'Testing secure direct messages from the other side.',
    },
    {
      label: 'Priya',
      email: `priya.${suffix}@demo.chatognito.local`,
      username: `priya_${suffix}`.slice(0, 20),
      displayName: 'Priya Demo',
      bio: 'Private-profile test account for block/unblock flows.',
      isPrivate: true,
    },
  ];
}

async function healthCheck() {
  await Promise.all([
    expectReachable(AUTH_URL, 'auth'),
    expectReachable(SOCIAL_URL, 'social'),
    expectReachable(MESSAGING_URL, 'messaging'),
    expectReachable(GATEWAY_URL, 'gateway'),
    expectReachable(CONTENT_URL, 'content'),
  ]);
}

async function expectReachable(baseUrl: string, label: string) {
  try {
    await fetch(baseUrl);
    logOk(`${label} service reachable`);
  } catch (err) {
    throw new Error(`${label} service is not reachable at ${baseUrl}`, { cause: err });
  }
}

async function onboardUsers(users: DemoUserInput[], overview: string[]) {
  section('1. People join, login, and build profiles');
  const sessions: DemoUserSession[] = [];

  for (const user of users) {
    try {
      await api<{ id: string; email: string }>(AUTH_URL, '/identity/auth/signup', {
        method: 'POST',
        body: { email: user.email, password: PASSWORD },
        expectedStatuses: [201],
      });
      logOk(`${user.label} signed up`);
    } catch (err) {
      if (isApiError(err, 409, 'EMAIL_IN_USE')) {
        logSkip(`${user.label} already exists, logging in instead`);
      } else {
        throw err;
      }
    }

    const login = await api<LoginResponse>(AUTH_URL, '/identity/auth/login', {
      method: 'POST',
      body: { email: user.email, password: PASSWORD },
    });
    logOk(`${user.label} logged in`);

    if (login.user.username !== user.username) {
      await api(AUTH_URL, '/identity/profile/me/username', {
        method: 'PUT',
        token: login.token,
        body: { username: user.username },
      });
      logOk(`${user.label} set username @${user.username}`);
    } else {
      logSkip(`${user.label} username already set`);
    }

    await api(AUTH_URL, '/identity/profile/me', {
      method: 'PATCH',
      token: login.token,
      body: {
        displayName: user.displayName,
        bio: user.bio,
        isPrivate: user.isPrivate ?? false,
      },
    });
    logOk(`${user.label} updated profile`);

    sessions.push({ ...user, id: login.user.id, token: login.token });
  }

  overview.push(`Created and logged in ${sessions.length} demo users through Auth APIs.`);
  return sessions as [DemoUserSession, DemoUserSession, DemoUserSession];
}

async function registerKeyBundles(users: DemoUserSession[], overview: string[]) {
  section('2. Security keys are published and fetched');

  for (const user of users) {
    const keys = createDemoKeyMaterial();
    const signature = sign(keys.identitySigning.private, Buffer.from(keys.signedPreKey.public));

    await api(AUTH_URL, '/identity/security/keys', {
      method: 'POST',
      token: user.token,
      body: {
        identityDhPublicKey: keys.identityDh.public,
        identitySigningPublicKey: keys.identitySigning.public,
        signedPreKey: keys.signedPreKey.public,
        signedPreKeySignature: signature,
        oneTimePreKeys: keys.oneTimePreKeys.map((key) => key.public),
      },
    });

    user.keys = keys;
    logOk(`${user.label} uploaded X3DH key bundle`);
  }

  await api(AUTH_URL, `/identity/security/keys/${users[1].id}`, {
    method: 'GET',
    token: users[0].token,
  });
  logOk(`${users[0].label} fetched ${users[1].label}'s public key bundle`);
  overview.push('Published X3DH identity, signed pre-key, and one-time pre-key bundles.');
}

async function identityAndProfileTour(
  maya: DemoUserSession,
  priya: DemoUserSession,
  suffix: string,
  overview: string[],
) {
  section('3. Identity/profile APIs are exercised');

  await api(AUTH_URL, '/identity/profile/me/2fa/enable', {
    method: 'POST',
    token: maya.token,
  });
  logOk(`${maya.label} enabled mock 2FA`);

  await api(AUTH_URL, '/identity/profile/me/username/history', {
    method: 'GET',
    token: maya.token,
  });
  logOk(`${maya.label} fetched username history`);

  await api(AUTH_URL, `/identity/profile/search?q=${encodeURIComponent(suffix)}&limit=5`, {
    method: 'GET',
    token: maya.token,
  });
  logOk(`${maya.label} searched users by demo suffix`);

  await api(AUTH_URL, `/identity/profile/${maya.username}`, { method: 'GET' });
  logOk(`${maya.label}'s public profile is visible`);

  const privateProfile = await api<Record<string, unknown>>(
    AUTH_URL,
    `/identity/profile/${priya.username}`,
    { method: 'GET' },
  );
  logOk(
    `${priya.label}'s private profile hides details: ${Object.keys(privateProfile).join(', ')}`,
  );
  overview.push(
    'Touched username, profile update, search, public profile, private profile, and 2FA.',
  );
}

async function socialTour(
  maya: DemoUserSession,
  noah: DemoUserSession,
  priya: DemoUserSession,
  overview: string[],
) {
  section('4. Social graph, friendship, and block rules');

  await api(SOCIAL_URL, `/social/follow/${noah.id}`, {
    method: 'POST',
    token: maya.token,
    expectedStatuses: [200],
  });
  logOk(`${maya.label} followed ${noah.label}`);

  await api(SOCIAL_URL, `/social/follow/${maya.id}`, {
    method: 'POST',
    token: noah.token,
    expectedStatuses: [200],
  });
  logOk(`${noah.label} followed ${maya.label}`);

  const friendStatus = await api<Record<string, boolean>>(SOCIAL_URL, `/social/status/${noah.id}`, {
    method: 'GET',
    token: maya.token,
  });
  logOk(`${maya.label} and ${noah.label} friend status: ${friendStatus.isFriend}`);

  await api(SOCIAL_URL, `/social/followers/${maya.id}`, {
    method: 'GET',
    token: maya.token,
  });
  await api(SOCIAL_URL, `/social/following/${maya.id}`, {
    method: 'GET',
    token: maya.token,
  });
  logOk(`${maya.label} fetched followers and following`);

  await expectApiFailure(
    'self-follow is rejected',
    SOCIAL_URL,
    `/social/follow/${maya.id}`,
    { method: 'POST', token: maya.token },
    400,
    'CANNOT_FOLLOW_SELF',
  );

  await api(SOCIAL_URL, `/social/block/${maya.id}`, {
    method: 'POST',
    token: priya.token,
  });
  logOk(`${priya.label} blocked ${maya.label}`);

  await expectApiFailure(
    'blocked users cannot start DMs',
    MESSAGING_URL,
    '/messaging/conversations/direct',
    {
      method: 'POST',
      token: maya.token,
      body: { targetUserId: priya.id },
    },
    403,
    'FORBIDDEN',
  );

  await api(SOCIAL_URL, `/social/unblock/${maya.id}`, {
    method: 'POST',
    token: priya.token,
  });
  logOk(`${priya.label} unblocked ${maya.label}`);

  overview.push(
    'Follow, mutual friend status, followers/following, block, unblock, and block guards ran.',
  );
}

async function messagingTour(
  maya: DemoUserSession,
  noah: DemoUserSession,
  priya: DemoUserSession,
  overview: string[],
) {
  section('5. Messaging APIs cover direct, encrypted, read, edit, delete, and groups');

  const direct = await api<Conversation>(MESSAGING_URL, '/messaging/conversations/direct', {
    method: 'POST',
    token: maya.token,
    body: { targetUserId: noah.id },
  });
  logOk(`${maya.label} opened a direct conversation with ${noah.label}`);

  const plain = await api<Message>(
    MESSAGING_URL,
    `/messaging/conversations/${direct.id}/messages`,
    {
      method: 'POST',
      token: maya.token,
      body: { content: `Plain REST hello from ${maya.label}` },
      expectedStatuses: [201],
    },
  );
  logOk(`REST message created: ${plain.id}`);

  await api(MESSAGING_URL, `/messaging/conversations/${direct.id}/messages/${plain.id}`, {
    method: 'PATCH',
    token: maya.token,
    body: { content: `Edited REST hello from ${maya.label}` },
  });
  logOk('REST message edited');

  await api(MESSAGING_URL, `/messaging/conversations/${direct.id}/read`, {
    method: 'POST',
    token: noah.token,
  });
  logOk(`${noah.label} marked the direct conversation read`);

  const encryptedRest = createEncryptedPayload('REST encrypted direct message');
  const encrypted = await api<Message>(
    MESSAGING_URL,
    `/messaging/conversations/${direct.id}/messages`,
    {
      method: 'POST',
      token: noah.token,
      body: {
        content: encryptedRest.ciphertext,
        isEncrypted: true,
        encryptionHeader: encryptedRest.encryptionHeader,
      },
      expectedStatuses: [201],
    },
  );
  logOk(`REST encrypted message stored: ${encrypted.id}`);

  await api(MESSAGING_URL, `/messaging/conversations/${direct.id}/messages`, {
    method: 'GET',
    token: maya.token,
  });
  logOk('Direct message list fetched');

  await api(MESSAGING_URL, `/messaging/conversations/${direct.id}/messages/${plain.id}`, {
    method: 'DELETE',
    token: maya.token,
  });
  logOk('REST message soft-deleted');

  const priyaDirect = await api<Conversation>(MESSAGING_URL, '/messaging/conversations/direct', {
    method: 'POST',
    token: maya.token,
    body: { targetUserId: priya.id },
  });
  logOk(`${maya.label} opened a direct conversation with ${priya.label}`);

  await api(SOCIAL_URL, `/social/block/${maya.id}`, {
    method: 'POST',
    token: priya.token,
  });
  await expectApiFailure(
    'messages fail when either side has blocked the other',
    MESSAGING_URL,
    `/messaging/conversations/${priyaDirect.id}/messages`,
    {
      method: 'POST',
      token: maya.token,
      body: { content: 'This should be blocked.' },
    },
    403,
    'FORBIDDEN',
  );
  await api(SOCIAL_URL, `/social/unblock/${maya.id}`, {
    method: 'POST',
    token: priya.token,
  });

  const group = await api<Conversation>(MESSAGING_URL, '/messaging/conversations/group', {
    method: 'POST',
    token: maya.token,
    body: { title: `Demo Group ${direct.id.slice(0, 4)}`, memberIds: [noah.id] },
    expectedStatuses: [201],
  });
  logOk(`${maya.label} created a group conversation`);

  await api(MESSAGING_URL, `/messaging/conversations/${group.id}/participants`, {
    method: 'POST',
    token: maya.token,
    body: { targetUserId: priya.id },
  });
  logOk(`${priya.label} added to group`);

  await api(MESSAGING_URL, `/messaging/conversations/${group.id}/participants/${priya.id}/role`, {
    method: 'PUT',
    token: maya.token,
    body: { role: 'admin' },
  });
  logOk(`${priya.label} promoted to group admin`);

  await api(MESSAGING_URL, `/messaging/conversations/${group.id}/title`, {
    method: 'PATCH',
    token: priya.token,
    body: { title: `Phase 3 Demo ${direct.id.slice(0, 4)}` },
  });
  logOk('Group title updated');

  for (const line of ['Group hello one', 'Group hello two', 'Group hello three']) {
    await api(MESSAGING_URL, `/messaging/conversations/${group.id}/messages`, {
      method: 'POST',
      token: noah.token,
      body: { content: line },
      expectedStatuses: [201],
    });
  }

  await api(MESSAGING_URL, `/messaging/conversations/${group.id}/messages?limit=2`, {
    method: 'GET',
    token: maya.token,
  });
  logOk('Group messages paginated');

  await api(MESSAGING_URL, `/messaging/conversations/${group.id}/participants/${noah.id}`, {
    method: 'DELETE',
    token: priya.token,
  });
  logOk(`${priya.label} removed ${noah.label} from group`);

  overview.push(
    'Messaging REST direct, encrypted flags, read, edit, delete, blocking, groups, roles, and pagination ran.',
  );
  return direct;
}

async function gatewayTour(
  maya: DemoUserSession,
  noah: DemoUserSession,
  conversationId: string,
  overview: string[],
) {
  section('6. Gateway sockets open, sign packets, deliver messages, and close');

  const mayaSocket = await openSecureSocket(maya);
  logOk(`${maya.label} socket opened and completed ECDH/HMAC handshake`);

  let noahSocket: SecureSocketSession;
  try {
    noahSocket = await openSecureSocket(noah);
  } catch (err) {
    await closeSocket(mayaSocket);
    throw err;
  }
  logOk(`${noah.label} socket opened and completed ECDH/HMAC handshake`);

  const badAck = await emitRawAck<GatewayAck>(mayaSocket.socket, 'presence:get', {
    nonce: crypto.randomUUID(),
    timestamp: Date.now(),
    data: { userIds: [noah.id] },
    signature: '0'.repeat(64),
  });
  if (badAck.ok) throw new Error('Tampered packet unexpectedly passed integrity checks');
  logOk(`tampered HMAC packet rejected with ${badAck.error.code}`);

  const replayPacket = buildPacket(mayaSocket.packetKey, 'presence:get', {
    userIds: [maya.id, noah.id],
  });
  const firstPresence = await emitRawAck<GatewayAck<{ statuses: PresenceStatus[] }>>(
    mayaSocket.socket,
    'presence:get',
    replayPacket,
  );
  const presenceData = assertGatewayOk(firstPresence, 'presence:get');
  const replayAck = await emitRawAck<GatewayAck>(mayaSocket.socket, 'presence:get', replayPacket);
  if (replayAck.ok) throw new Error('Replayed packet unexpectedly passed integrity checks');
  logOk(`replayed packet rejected with ${replayAck.error.code}`);
  logOk(
    `presence snapshot: ${presenceData.statuses
      .map((status) => `${shortUser(status.userId)}=${status.online ? 'online' : 'offline'}`)
      .join(', ')}`,
  );

  await emitSigned(mayaSocket, 'conversation:join', { conversationId });
  await emitSigned(noahSocket, 'conversation:join', { conversationId });
  logOk('both sockets joined the direct conversation room');

  const deliveredToNoah = waitForEvent(noahSocket.socket, 'message:new');
  const encryptedSocket = createEncryptedPayload('Socket encrypted direct message');
  const sendAck = await emitSigned<{ messageId: string; clientMessageId?: string }>(
    mayaSocket,
    'dm:send',
    {
      conversationId,
      content: encryptedSocket.ciphertext,
      encryptionHeader: encryptedSocket.encryptionHeader,
      clientMessageId: `demo-${Date.now()}`,
    },
  );
  await deliveredToNoah;
  logOk(`socket encrypted DM stored and broadcast: ${sendAck.messageId}`);

  const readSeenByMaya = waitForEvent(mayaSocket.socket, 'message:read');
  await emitSigned(noahSocket, 'message:read', { conversationId });
  await readSeenByMaya;
  logOk(`${noah.label} sent a signed read receipt over the socket`);

  const offlineSeenByMaya = waitForEvent(mayaSocket.socket, 'presence:update', 3000).catch(
    () => null,
  );
  await closeSocket(noahSocket);
  const offlineStatus = await offlineSeenByMaya;
  if (offlineStatus) {
    logOk(`${maya.label} saw ${noah.label}'s offline presence update`);
  } else {
    logSkip('offline presence update was not observed before timeout');
  }

  await closeSocket(mayaSocket);
  logOk(`${maya.label} socket closed`);

  overview.push(
    'Gateway socket auth, open, ECDH, HMAC, replay rejection, presence, encrypted DM, read receipt, and close ran.',
  );
}

async function contentTour(maya: DemoUserSession, noah: DemoUserSession, overview: string[]) {
  section('7. Content Discovery: Posts and Media');

  const post1 = await api<DemoPost>(CONTENT_URL, '/content/posts', {
    method: 'POST',
    token: maya.token,
    body: {
      content: 'Hello Chatognito! This is my first public post. #demo',
      visibility: 'public',
    },
    expectedStatuses: [201],
  });
  logOk(`${maya.label} created a public post: ${post1.id}`);

  const post2 = await api<DemoPost>(CONTENT_URL, '/content/posts', {
    method: 'POST',
    token: noah.token,
    body: {
      content: 'Check out this awesome view from my trip!',
      visibility: 'followers',
      media: [
        {
          type: 'image',
          url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb',
          metadata: { width: 1920, height: 1080 },
        },
        {
          type: 'video',
          url: 'https://www.w3schools.com/html/mov_bbb.mp4',
          metadata: { duration: 10 },
        },
      ],
    },
    expectedStatuses: [201],
  });
  logOk(`${noah.label} created a post with 2 media attachments`);

  await api(CONTENT_URL, `/content/posts/${post1.id}`, { method: 'GET' });
  logOk(`Public post ${post1.id} is reachable by anyone`);

  // Social Interactions: Likes & Comments
  await api(CONTENT_URL, `/content/posts/${post1.id}/like`, {
    method: 'POST',
    token: noah.token,
  });
  logOk(`${noah.label} liked ${maya.label}'s post`);

  const comment1 = await api<DemoComment>(CONTENT_URL, `/content/posts/${post1.id}/comments`, {
    method: 'POST',
    token: noah.token,
    body: { content: 'Great post, Maya!' },
    expectedStatuses: [201],
  });
  logOk(`${noah.label} commented on ${maya.label}'s post`);

  const mayaReply = await api<DemoComment>(CONTENT_URL, `/content/posts/${post1.id}/comments`, {
    method: 'POST',
    token: maya.token,
    body: { content: 'Thanks Noah!', parentId: comment1.id },
    expectedStatuses: [201],
  });
  logOk(`${maya.label} replied to ${noah.label}'s comment`);

  const postWithStats = await api<DemoPost>(CONTENT_URL, `/content/posts/${post1.id}`, {
    method: 'GET',
  });
  logOk(
    `Post engagement: ${postWithStats._count.likes} likes, ${postWithStats._count.comments} comments`,
  );

  // Edge Cases & Security Hardening
  await api(CONTENT_URL, `/content/posts/${post1.id}/like`, {
    method: 'POST',
    token: noah.token,
  });
  logOk('Like idempotency: Noah liked the same post again without error');

  await expectApiFailure(
    'Cannot comment on non-existent post',
    CONTENT_URL,
    `/content/posts/00000000-0000-0000-0000-000000000000/comments`,
    { method: 'POST', token: maya.token, body: { content: 'Ghost comment' } },
    404,
    'POST_NOT_FOUND',
  );

  await api<DemoComment>(CONTENT_URL, `/content/posts/${post1.id}/comments`, {
    method: 'POST',
    token: noah.token,
    body: { content: 'No problem, Maya! Happy to help.', parentId: comment1.id },
    expectedStatuses: [201],
  });
  logOk('Threaded depth: Noah replied to the reply');

  await expectApiFailure(
    "Ownership guard: Noah cannot delete Maya's reply",
    CONTENT_URL,
    `/content/posts/${post1.id}/comments/${mayaReply.id}`,
    { method: 'DELETE', token: noah.token },
    403,
    'FORBIDDEN',
  );

  await api(CONTENT_URL, `/content/posts/${post2.id}`, {
    method: 'DELETE',
    token: noah.token,
  });
  logOk(`${noah.label} deleted their own post`);

  overview.push('Content Discovery: created posts with media and verified ownership security.');
}

async function api<T = unknown>(
  baseUrl: string,
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  const payload = parseJson(text);
  const expectedStatuses = options.expectedStatuses || [200];

  if (!expectedStatuses.includes(response.status)) {
    throw new ApiError(
      `${options.method || 'GET'} ${path} failed with ${response.status}`,
      response.status,
      payload,
    );
  }

  return payload as T;
}

async function expectApiFailure(
  label: string,
  baseUrl: string,
  path: string,
  options: ApiOptions,
  expectedStatus: number,
  expectedError: string,
) {
  try {
    await api(baseUrl, path, options);
  } catch (err) {
    if (isApiError(err, expectedStatus, expectedError)) {
      logOk(`${label}: ${expectedError}`);
      return;
    }

    throw err;
  }

  throw new Error(`${label}: expected ${expectedError}, but request succeeded`);
}

function parseJson(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch (_err) {
    return { raw: text };
  }
}

function isApiError(err: unknown, status: number, errorCode: string) {
  if (!(err instanceof ApiError) || err.status !== status) return false;
  if (!err.body || typeof err.body !== 'object') return false;
  return (err.body as { error?: string }).error === errorCode;
}

function createDemoKeyMaterial(): DemoKeyMaterial {
  return {
    identityDh: generateDhKeyPair(),
    identitySigning: generateSigningKeyPair(),
    signedPreKey: generateDhKeyPair(),
    oneTimePreKeys: [generateDhKeyPair(), generateDhKeyPair(), generateDhKeyPair()],
  };
}

function generateDhKeyPair(): KeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { public: publicKey, private: privateKey };
}

function generateSigningKeyPair(): KeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { public: publicKey, private: privateKey };
}

function sign(privateKey: string, data: Buffer) {
  return crypto.sign(null, data, crypto.createPrivateKey(privateKey)).toString('hex');
}

function createEncryptedPayload(plaintext: string): EncryptedPayload {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  const senderRatchetKey = generateDhKeyPair();

  return {
    plaintext,
    ciphertext,
    encryptionHeader: JSON.stringify({
      version: 1,
      algorithm: 'X3DH-DOUBLE-RATCHET-AES-256-GCM',
      ratchetHeader: {
        dhPubKey: senderRatchetKey.public,
        msgNum: 0,
        prevMsgNum: 0,
      },
      iv: iv.toString('hex'),
      tag,
      sessionId: crypto.randomUUID(),
      senderEphemeralPublicKey: senderRatchetKey.public,
    }),
  };
}

async function openSecureSocket(user: DemoUserSession): Promise<SecureSocketSession> {
  const socket = io(GATEWAY_URL, {
    auth: { token: user.token },
    transports: ['websocket'],
    forceNew: true,
    multiplex: false,
    reconnection: false,
    timeout: 5000,
  });

  const events: SecureSocketSession['events'] = {
    messages: [],
    presence: [],
    reads: [],
  };

  socket.on('message:new', (payload: unknown) => events.messages.push(payload));
  socket.on('presence:update', (payload: PresenceStatus) => events.presence.push(payload));
  socket.on('message:read', (payload: unknown) => events.reads.push(payload));

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(
        new Error(
          `Timed out opening secure socket for ${user.label}. Check gateway logs for auth or handshake errors.`,
        ),
      );
    }, 7000);

    socket.once('connect_error', (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });

    const onGatewayError = (err: { code?: string; message?: string }) => {
      clearTimeout(timeout);
      socket.disconnect();
      reject(new Error(`Gateway rejected ${user.label}'s socket: ${err.code || err.message}`));
    };
    socket.once('gateway:error', onGatewayError);

    socket.once('security:handshake', (payload: SecurityHandshakePayload) => {
      try {
        const clientKeys = generateDhKeyPair();
        const packetKey = derivePacketKey(
          clientKeys.private,
          payload.serverPublicKey,
          payload.challenge,
        );
        const signature = signHandshakeProof(packetKey, user.id, payload.challenge);

        socket.emit(
          'security:handshake:ack',
          {
            clientPublicKey: clientKeys.public,
            signature,
          },
          (ack: GatewayAck<{ established: true }>) => {
            clearTimeout(timeout);
            socket.off('gateway:error', onGatewayError);
            if (!ack.ok) {
              reject(new Error(`Socket security handshake failed: ${ack.error.code}`));
              return;
            }

            resolve({ user, socket, packetKey, events });
          },
        );
      } catch (err) {
        clearTimeout(timeout);
        socket.off('gateway:error', onGatewayError);
        reject(err);
      }
    });
  });
}

function derivePacketKey(clientPrivateKey: string, serverPublicKey: string, challenge: string) {
  const sharedSecret = crypto.diffieHellman({
    privateKey: crypto.createPrivateKey(clientPrivateKey),
    publicKey: crypto.createPublicKey(serverPublicKey),
  });

  return Buffer.from(
    crypto.hkdfSync('sha256', sharedSecret, Buffer.from(challenge), PACKET_KEY_INFO, 32),
  );
}

function signHandshakeProof(packetKey: Buffer, userId: string, challenge: string) {
  return crypto
    .createHmac('sha256', packetKey)
    .update(stableStringify({ challenge, event: HANDSHAKE_PROOF_EVENT, userId }))
    .digest('hex');
}

function buildPacket<TData>(
  packetKey: Buffer,
  event: string,
  data: TData,
): SignedSocketPacket<TData> {
  const packet = {
    nonce: crypto.randomUUID(),
    timestamp: Date.now(),
    data,
  };

  return {
    ...packet,
    signature: crypto
      .createHmac('sha256', packetKey)
      .update(
        stableStringify({
          data,
          event,
          nonce: packet.nonce,
          timestamp: packet.timestamp,
        }),
      )
      .digest('hex'),
  };
}

async function emitSigned<TData = unknown>(
  session: SecureSocketSession,
  event: string,
  data: unknown,
): Promise<TData> {
  const packet = buildPacket(session.packetKey, event, data);
  const ack = await emitRawAck<GatewayAck<TData>>(session.socket, event, packet);
  return assertGatewayOk(ack, event);
}

function emitRawAck<TAck>(socket: Socket, event: string, payload: unknown): Promise<TAck> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Socket event timed out: ${event}`));
    }, 5000);

    socket.emit(event, payload, (ack: TAck) => {
      clearTimeout(timeout);
      resolve(ack);
    });
  });
}

function assertGatewayOk<TData>(ack: GatewayAck<TData>, event: string) {
  if (!ack.ok) {
    throw new Error(`Gateway event ${event} failed: ${ack.error.code}`);
  }

  return ack.data;
}

function waitForEvent<TPayload = unknown>(
  socket: Socket,
  event: string,
  timeoutMs = 5000,
): Promise<TPayload> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for socket event: ${event}`));
    }, timeoutMs);

    const handler = (payload: TPayload) => {
      clearTimeout(timeout);
      resolve(payload);
    };

    socket.once(event, handler);
  });
}

async function closeSocket(session: SecureSocketSession) {
  if (!session.socket.connected) return;

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 1000);
    session.socket.once('disconnect', () => {
      clearTimeout(timeout);
      resolve();
    });
    session.socket.disconnect();
  });
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortValue(nestedValue)]),
    );
  }

  return value;
}

function section(title: string) {
  console.log(`\n${title}`);
}

function logOk(message: string) {
  console.log(`  [ok] ${message}`);
}

function logSkip(message: string) {
  console.log(`  [skip] ${message}`);
}

function shortUser(userId: string) {
  return userId.slice(0, 8);
}

function printOverview(overview: string[]) {
  console.log('\nScenario overview');
  for (const item of overview) {
    console.log(`  - ${item}`);
  }
  console.log(
    '\nDone. Your local app now has a fresh demo population and exercised API/socket flows.',
  );
}

main().catch((err) => {
  console.error('\nScenario failed.');
  if (err instanceof ApiError) {
    console.error(`${err.message}`);
    console.error(JSON.stringify(err.body, null, 2));
  } else if (err instanceof Error) {
    console.error(err.message);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
