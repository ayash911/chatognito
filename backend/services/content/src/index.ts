import '@common/load-env';
import 'express-async-errors';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { logger, httpLogger } from '@chatognito/logger';
import { z } from 'zod';

import { contentRouter } from './routes/post.routes';

const app = express();

app.use(httpLogger);
app.use(helmet());
app.use(cors());
app.use(express.json());

// Routes
app.use('/content', contentRouter);

app.get('/content/health', (_req, res) => {
  res.json({ status: 'up', service: 'content' });
});

// Global Error Handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const expectedErrors = ['POST_NOT_FOUND', 'COMMENT_NOT_FOUND', 'FORBIDDEN', 'AUTHOR_NOT_FOUND'];

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

  if (err.message === 'POST_NOT_FOUND' || err.message === 'COMMENT_NOT_FOUND') {
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

const PORT = process.env.CONTENT_PORT || 8084;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`Content Service listening on port ${PORT}`);
  });
}

export { app };
