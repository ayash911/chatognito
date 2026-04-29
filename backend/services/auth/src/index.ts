import '../../common/src/load-env';
import 'express-async-errors';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { logger, httpLogger } from '@chatognito/logger';

import { authRouter } from './routes/auth.routes';
import { profileRouter } from './routes/profile.routes';
import { securityRouter } from './routes/security.routes';
import { z } from 'zod';

const app = express();

app.use(httpLogger);
app.use(helmet());
app.use(cors());
app.use(express.json());

// Routes
app.use('/identity/auth', authRouter);
app.use('/identity/profile', profileRouter);
app.use('/identity/security', securityRouter);

app.get('/identity/health', (_req, res) => {
  res.json({ status: 'up', service: 'auth' });
});

// Global Error Handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const isExpectedError =
    [
      'USERNAME_TAKEN',
      'USERNAME_TAKEN_OR_PENDING',
      'EMAIL_IN_USE',
      'COOLDOWN_ACTIVE',
      'INVALID_FORMAT',
      'INVALID_CREDENTIALS',
      'ACCOUNT_DELETED',
      'USERNAME_RESERVED',
      'USER_REMOVED',
    ].some((msg) => err.message.includes(msg)) || err instanceof z.ZodError;

  if (isExpectedError) {
    logger.warn(`Expected Error: ${err.message} [${req.method} ${req.path}]`);
  } else {
    logger.error({ err, msg: 'Unhandled Error', path: req.path });
  }

  if (err instanceof z.ZodError) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: err.errors });
  }
  if (
    err.message === 'USERNAME_TAKEN' ||
    err.message === 'USERNAME_TAKEN_OR_PENDING' ||
    err.message === 'EMAIL_IN_USE'
  ) {
    return res.status(409).json({ error: err.message });
  }
  if (err.message === 'COOLDOWN_ACTIVE') {
    return res.status(429).json({ error: err.message });
  }
  if (err.message.startsWith('INVALID_FORMAT') || err.message === 'INVALID_CREDENTIALS') {
    return res.status(400).json({ error: err.message });
  }
  if (err.message === 'USER_NOT_FOUND') {
    return res.status(404).json({ error: err.message });
  }
  if (err.message === 'ACCOUNT_DELETED') {
    return res.status(403).json({ error: err.message });
  }
  if (err.message === 'USERNAME_RESERVED') {
    return res.status(400).json({ error: err.message });
  }
  if (err.message === 'USER_REMOVED') {
    return res.status(401).json({ error: err.message });
  }

  res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
});

const PORT = process.env.PORT || 8080;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`Auth Service listening on port ${PORT}`);
  });
}

export { app };
