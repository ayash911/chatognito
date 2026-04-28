import '@common/load-env';
import 'express-async-errors';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { logger, httpLogger } from '@chatognito/logger';
import { z } from 'zod';

import { socialRouter } from './routes/social.routes';

const app = express();

app.use(httpLogger);
app.use(helmet());
app.use(cors());
app.use(express.json());

// Routes
app.use('/social', socialRouter);

// Global Error Handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const expectedErrors = [
    'ALREADY_FOLLOWING',
    'NOT_FOLLOWING',
    'CANNOT_FOLLOW_SELF',
    'CANNOT_BLOCK_SELF',
    'ALREADY_BLOCKED',
    'NOT_BLOCKED',
    'USER_NOT_FOUND',
    'FORBIDDEN',
  ];

  const isExpected = expectedErrors.some((msg) => err.message.includes(msg));
  if (isExpected) {
    logger.warn(`Expected Error: ${err.message} [${req.method} ${req.path}]`);
  } else {
    logger.error({ err, msg: 'Unhandled Error', path: req.path });
  }

  if (err instanceof z.ZodError) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: err.errors });
  }

  if (err.message === 'USER_NOT_FOUND') {
    return res.status(404).json({ error: err.message });
  }

  if (err.message === 'FORBIDDEN') {
    return res.status(403).json({ error: err.message });
  }

  if (expectedErrors.includes(err.message)) {
    return res.status(400).json({ error: err.message });
  }

  res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
});

const PORT = process.env.SOCIAL_PORT || 8082;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`Social Service listening on port ${PORT}`);
  });
}

export { app };
