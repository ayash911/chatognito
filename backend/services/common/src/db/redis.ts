import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6380';

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});
