import type { Server } from 'socket.io';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { logger } from '@chatognito/logger';
import { MessageService } from '@messaging/services/message.service';
import type {
  ClientToServerEvents,
  EncryptedDirectMessagePayload,
  GatewayAck,
  GatewaySocket,
  GatewaySocketData,
  InterServerEvents,
  JoinConversationPayload,
  PresenceGetPayload,
  ReadReceiptPayload,
  SecurityHandshakeAckPayload,
  ServerToClientEvents,
  SignedSocketPacket,
} from '../types';
import {
  PacketIntegrityService,
  type PacketNonceStore,
} from '../services/packet-integrity.service';
import { PresenceService } from '../services/presence.service';
import { ConversationSocketService } from '../services/conversation-socket.service';

type GatewayServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  GatewaySocketData
>;

const uuidSchema = z.string().uuid();

const encryptedDirectMessageSchema = z.object({
  conversationId: uuidSchema,
  content: z.string().min(1),
  encryptionHeader: z.string().min(1),
  clientMessageId: z.string().max(128).optional(),
});

const joinConversationSchema = z.object({
  conversationId: uuidSchema,
});

const presenceGetSchema = z.object({
  userIds: z.array(uuidSchema).max(100),
});

const readReceiptSchema = z.object({
  conversationId: uuidSchema,
});

export function registerSocketHandlers(
  io: GatewayServer,
  presenceService: PresenceService,
  nonceStore: PacketNonceStore,
) {
  io.on('connection', async (socket) => {
    if (socket.handshake.query.type === 'dashboard') {
      logger.info({ socketId: socket.id }, 'Dashboard socket connected');
      return;
    }

    const user = socket.data.user;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    logger.info({ socketId: socket.id, userId: user.userId }, 'Gateway socket connected');
    socket.join(userRoom(user.userId));

    socket.on('security:handshake:ack', (payload, ack) => {
      void establishPacketSecurity(socket, payload, ack);
    });

    socket.on('conversation:join', (packet, ack) => {
      void verifyPacket(socket, nonceStore, 'conversation:join', packet, ack, async (data) => {
        const payload = joinConversationSchema.parse(data) as JoinConversationPayload;
        await ConversationSocketService.assertParticipant(payload.conversationId, user.userId);
        socket.join(conversationRoom(payload.conversationId));
        socket.emit('conversation:joined', { conversationId: payload.conversationId });
        ack?.({ ok: true, data: { conversationId: payload.conversationId } });
      });
    });

    const handleEncryptedSend = (
      event: 'dm:send' | 'message:send',
      packet: SignedSocketPacket<EncryptedDirectMessagePayload>,
      ack?: GatewayAck<{ messageId: string; clientMessageId?: string }>,
    ) => {
      void verifyPacket(socket, nonceStore, event, packet, ack, async (data) => {
        const payload = encryptedDirectMessageSchema.parse(data) as EncryptedDirectMessagePayload;
        const message = await MessageService.sendEncryptedDirect(
          payload.conversationId,
          user.userId,
          payload.content,
          payload.encryptionHeader,
        );

        io.to(conversationRoom(payload.conversationId)).emit('message:new', {
          conversationId: payload.conversationId,
          message,
          clientMessageId: payload.clientMessageId,
        });

        ack?.({
          ok: true,
          data: {
            messageId: message.id,
            clientMessageId: payload.clientMessageId,
          },
        });
      });
    };

    socket.on('dm:send', (packet, ack) => handleEncryptedSend('dm:send', packet, ack));
    socket.on('message:send', (packet, ack) => handleEncryptedSend('message:send', packet, ack));

    socket.on('message:read', (packet, ack) => {
      void verifyPacket(socket, nonceStore, 'message:read', packet, ack, async (data) => {
        const payload = readReceiptSchema.parse(data) as ReadReceiptPayload;
        await MessageService.markRead(payload.conversationId, user.userId);
        const readAt = new Date().toISOString();

        io.to(conversationRoom(payload.conversationId)).emit('message:read', {
          conversationId: payload.conversationId,
          userId: user.userId,
          readAt,
        });

        ack?.({ ok: true, data: { conversationId: payload.conversationId } });
      });
    });

    socket.on('presence:get', (packet, ack) => {
      void verifyPacket(socket, nonceStore, 'presence:get', packet, ack, async (data) => {
        const payload = presenceGetSchema.parse(data) as PresenceGetPayload;
        const statuses = await presenceService.getManyStatuses(payload.userIds);
        ack?.({ ok: true, data: { statuses } });
      });
    });

    socket.on('disconnect', () => {
      void (async () => {
        const status = await presenceService.markOffline(user.userId, socket.id);
        await broadcastPresence(io, user.userId, status);
        logger.info({ socketId: socket.id, userId: user.userId }, 'Gateway socket disconnected');
      })().catch((err) => emitError(socket, err));
    });

    try {
      await joinExistingConversationRooms(socket);
      await startSecurityHandshake(socket);
      const status = await presenceService.markOnline(user.userId, socket.id);
      await broadcastPresence(io, user.userId, status);
    } catch (err) {
      emitError(socket, err);
    }
  });
}

async function startSecurityHandshake(socket: GatewaySocket) {
  const serverKeys = await PacketIntegrityService.generateEphemeralKeyPair();
  const challenge = cryptoRandomChallenge();

  socket.data.handshake = {
    serverPrivateKey: serverKeys.private,
    challenge,
  };

  socket.emit('security:handshake', {
    serverPublicKey: serverKeys.public,
    challenge,
    algorithms: {
      keyExchange: 'X25519',
      kdf: 'HKDF-SHA256',
      packetMac: 'HMAC-SHA256',
    },
  });
}

async function establishPacketSecurity(
  socket: GatewaySocket,
  payload: SecurityHandshakeAckPayload,
  ack?: GatewayAck<{ established: true }>,
) {
  try {
    if (!socket.data.handshake) throw new Error('SECURITY_HANDSHAKE_NOT_STARTED');

    const packetKey = PacketIntegrityService.derivePacketKey(
      socket.data.handshake.serverPrivateKey,
      payload.clientPublicKey,
      socket.data.handshake.challenge,
    );

    PacketIntegrityService.verifyHandshakeProof(
      packetKey,
      socket.data.user.userId,
      socket.data.handshake.challenge,
      payload.signature,
    );

    socket.data.packetKey = packetKey;
    socket.data.handshake = undefined;
    socket.emit('security:ready', { established: true });
    ack?.({ ok: true, data: { established: true } });
  } catch (err) {
    emitError(socket, err, ack);
  }
}

async function verifyPacket<TData, TAckData>(
  socket: GatewaySocket,
  nonceStore: PacketNonceStore,
  event: string,
  packet: SignedSocketPacket<TData>,
  ack: GatewayAck<TAckData> | undefined,
  handler: (data: TData) => Promise<void>,
) {
  try {
    const data = await PacketIntegrityService.verify(
      socket.data.packetKey,
      event,
      packet,
      nonceStore,
      `gateway:packet-nonce:${socket.data.user.userId}`,
    );
    await handler(data);
  } catch (err) {
    emitError(socket, err, ack);
  }
}

async function joinExistingConversationRooms(socket: GatewaySocket) {
  const conversationIds = await ConversationSocketService.listConversationIds(
    socket.data.user.userId,
  );
  for (const conversationId of conversationIds) {
    socket.join(conversationRoom(conversationId));
  }
}

async function broadcastPresence(
  io: GatewayServer,
  userId: string,
  status: Awaited<ReturnType<PresenceService['getStatus']>>,
) {
  const audience = await ConversationSocketService.listPresenceAudience(userId);
  for (const audienceUserId of audience) {
    io.to(userRoom(audienceUserId)).emit('presence:update', status);
  }
}

function emitError<TAckData>(socket: GatewaySocket, err: unknown, ack?: GatewayAck<TAckData>) {
  const error = normalizeError(err);
  logger.warn(
    { err, socketId: socket.id, userId: socket.data.user?.userId },
    'Gateway socket error',
  );
  socket.emit('gateway:error', error);
  ack?.({ ok: false, error });
}

function normalizeError(err: unknown) {
  if (err instanceof z.ZodError) {
    return { code: 'VALIDATION_ERROR', message: 'Invalid socket payload' };
  }

  if (err instanceof Error) {
    return { code: err.message, message: err.message };
  }

  return { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' };
}

function conversationRoom(conversationId: string) {
  return `conversation:${conversationId}`;
}

function userRoom(userId: string) {
  return `user:${userId}`;
}

function cryptoRandomChallenge() {
  return randomBytes(32).toString('hex');
}
