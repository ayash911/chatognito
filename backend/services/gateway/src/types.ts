import type { Socket } from 'socket.io';

export interface GatewayUser {
  userId: string;
  email: string;
  role: 'user' | 'moderator' | 'admin';
}

export interface SignedSocketPacket<TData = unknown> {
  nonce: string;
  timestamp: number;
  data: TData;
  signature: string;
}

export interface GatewayAckSuccess<TData = unknown> {
  ok: true;
  data: TData;
}

export interface GatewayAckFailure {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export type GatewayAck<TData = unknown> = (
  response: GatewayAckSuccess<TData> | GatewayAckFailure,
) => void;

export interface GatewaySocketData {
  user: GatewayUser;
  packetKey?: Buffer;
  handshake?: {
    serverPrivateKey: string;
    challenge: string;
  };
}

export interface SecurityHandshakePayload {
  serverPublicKey: string;
  challenge: string;
  algorithms: {
    keyExchange: 'X25519';
    kdf: 'HKDF-SHA256';
    packetMac: 'HMAC-SHA256';
  };
}

export interface SecurityHandshakeAckPayload {
  clientPublicKey: string;
  signature: string;
}

export interface EncryptedDirectMessagePayload {
  conversationId: string;
  content: string;
  encryptionHeader: string;
  clientMessageId?: string;
}

export interface JoinConversationPayload {
  conversationId: string;
}

export interface PresenceGetPayload {
  userIds: string[];
}

export interface ReadReceiptPayload {
  conversationId: string;
}

export interface ClientToServerEvents {
  'security:handshake:ack': (
    payload: SecurityHandshakeAckPayload,
    ack?: GatewayAck<{ established: true }>,
  ) => void;
  'conversation:join': (
    packet: SignedSocketPacket<JoinConversationPayload>,
    ack?: GatewayAck<{ conversationId: string }>,
  ) => void;
  'dm:send': (
    packet: SignedSocketPacket<EncryptedDirectMessagePayload>,
    ack?: GatewayAck<{ messageId: string; clientMessageId?: string }>,
  ) => void;
  'message:send': (
    packet: SignedSocketPacket<EncryptedDirectMessagePayload>,
    ack?: GatewayAck<{ messageId: string; clientMessageId?: string }>,
  ) => void;
  'message:read': (
    packet: SignedSocketPacket<ReadReceiptPayload>,
    ack?: GatewayAck<{ conversationId: string }>,
  ) => void;
  'presence:get': (
    packet: SignedSocketPacket<PresenceGetPayload>,
    ack?: GatewayAck<{ statuses: PresenceStatus[] }>,
  ) => void;
}

export interface ServerToClientEvents {
  'security:handshake': (payload: SecurityHandshakePayload) => void;
  'security:ready': (payload: { established: true }) => void;
  'conversation:joined': (payload: { conversationId: string }) => void;
  'message:new': (payload: {
    conversationId: string;
    message: unknown;
    clientMessageId?: string;
  }) => void;
  'message:read': (payload: { conversationId: string; userId: string; readAt: string }) => void;
  'presence:update': (payload: PresenceStatus) => void;
  'gateway:error': (payload: GatewayAckFailure['error']) => void;
  'dashboard:log': (payload: unknown) => void;
  'dashboard:health_update': (payload: unknown) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface PresenceStatus {
  userId: string;
  online: boolean;
  lastSeenAt: string | null;
}

export type GatewaySocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  GatewaySocketData
>;
