import '@common/load-env';
import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import http from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { logger, httpLogger } from '@chatognito/logger';
import { prisma } from '@common/db/prisma';
import { redis } from '@common/db/redis';
import { SocketAuthService, type SocketAuthPrismaClient } from './services/socket-auth.service';
import { RedisNonceStore, type RedisLikeNonceStore } from './services/packet-integrity.service';
import { PresenceService, type PresencePrismaClient } from './services/presence.service';
import { HealthService } from './services/health.service';
import { registerSocketHandlers } from './handlers/socket.handlers';
import type {
  ClientToServerEvents,
  GatewaySocketData,
  InterServerEvents,
  ServerToClientEvents,
} from './types';

const app = express();
const server = http.createServer(app);
const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  GatewaySocketData
>(server, {
  cors: {
    origin: process.env.GATEWAY_CORS_ORIGIN || '*',
    credentials: true,
  },
});

app.use(httpLogger);
app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/gateway/health', (_req, res) => {
  res.json({ ok: true, service: 'gateway' });
});

app.get('/gateway/status', async (_req, res) => {
  const status = HealthService.getCachedStatus();
  if (status.length === 0) {
    // If cache is empty, trigger a check
    const newStatus = await HealthService.checkAll();
    return res.json(newStatus);
  }
  res.json(status);
});

const authService = new SocketAuthService(prisma as unknown as SocketAuthPrismaClient);
const presenceService = new PresenceService(redis, prisma as unknown as PresencePrismaClient);
const nonceStore = new RedisNonceStore(redis as unknown as RedisLikeNonceStore);

io.use(async (socket, next) => {
  try {
    socket.data.user = await authService.authenticate(socket);
    next();
  } catch (err) {
    next(err instanceof Error ? err : new Error('UNAUTHORIZED'));
  }
});

if (process.env.GATEWAY_REDIS_ADAPTER !== 'false') {
  const subClient = redis.duplicate();
  io.adapter(createAdapter(redis, subClient));
  subClient.on('error', (err) => logger.error({ err }, 'Gateway Redis subscriber error'));
}

registerSocketHandlers(io, presenceService, nonceStore);

const PORT = process.env.GATEWAY_PORT || 8083;

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    logger.info(`Gateway Service listening on port ${PORT}`);
    HealthService.startBackgroundCheck();
  });
}

export { app, server, io };
