import '@common/load-env';
import 'express-async-errors';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { logger, httpLogger } from '@chatognito/logger';
import { z } from 'zod';

import { conversationRouter } from './routes/conversation.routes';

import { dashboardLogger } from '@common/middleware/dashboard.middleware';

const app = express();

app.use(dashboardLogger('Messaging Service'));
app.use(httpLogger);
app.use(helmet());
app.use(cors());
app.use(express.json());

// Routes
app.use('/messaging/conversations', conversationRouter);

app.get('/messaging/health', (_req, res) => {
  res.json({ status: 'up', service: 'messaging' });
});

// Global Error Handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const expectedErrors = [
    'NOT_A_PARTICIPANT',
    'CONVERSATION_NOT_FOUND',
    'MESSAGE_NOT_FOUND',
    'MESSAGE_EMPTY',
    'MESSAGE_TOO_LONG',
    'CANNOT_MESSAGE_SELF',
    'GROUP_NEEDS_MORE_MEMBERS',
    'INVALID_GROUP_TITLE',
    'USER_NOT_FOUND',
    'FORBIDDEN',
    'USER_REMOVED',
    'INVALID_ENCRYPTION_HEADER',
    'ENCRYPTED_DM_ONLY',
  ];

  const isExpected =
    expectedErrors.some((msg) => err.message.includes(msg)) || err instanceof z.ZodError;
  if (isExpected) {
    logger.warn(`Expected Error: ${err.message} [${req.method} ${req.path}]`);
  } else {
    logger.error({ err, msg: 'Unhandled Error', path: req.path });
  }

  if (err instanceof z.ZodError) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: err.errors });
  }
  if (
    err.message === 'CONVERSATION_NOT_FOUND' ||
    err.message === 'MESSAGE_NOT_FOUND' ||
    err.message === 'USER_NOT_FOUND'
  ) {
    return res.status(404).json({ error: err.message });
  }
  if (err.message === 'USER_REMOVED') {
    return res.status(401).json({ error: err.message });
  }
  if (err.message === 'NOT_A_PARTICIPANT' || err.message === 'FORBIDDEN') {
    return res.status(403).json({ error: err.message });
  }
  if (
    err.message === 'CANNOT_MESSAGE_SELF' ||
    err.message === 'MESSAGE_EMPTY' ||
    err.message === 'MESSAGE_TOO_LONG' ||
    err.message === 'GROUP_NEEDS_MORE_MEMBERS' ||
    err.message === 'INVALID_GROUP_TITLE' ||
    err.message === 'INVALID_ENCRYPTION_HEADER' ||
    err.message === 'ENCRYPTED_DM_ONLY' ||
    err.message === 'NOT_A_GROUP' ||
    err.message === 'ALREADY_A_MEMBER' ||
    err.message === 'CANNOT_REMOVE_LAST_PARTICIPANT' ||
    err.message === 'CANNOT_DEMOTE_LAST_ADMIN'
  ) {
    return res.status(400).json({ error: err.message });
  }

  res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
});

const PORT = process.env.MESSAGING_PORT || 8081;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`Messaging Service listening on port ${PORT}`);
  });
}

export { app };
