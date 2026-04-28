import Redis from 'ioredis';
import { logger } from '@chatognito/logger';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6380';

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

redis.on('error', (err) => {
  logger.error({ err, msg: 'ioredis Error' });
});
