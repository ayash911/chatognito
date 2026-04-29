import { PrismaClient } from '@chatognito/database';
import { logger } from '@chatognito/logger';

export const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'info' },
    { emit: 'event', level: 'warn' },
    { emit: 'event', level: 'error' },
  ],
});

if (process.env.NODE_ENV !== 'test' || process.env.LOG_PRISMA === 'true') {
  prisma.$on('query', (e) => {
    logger.debug({ query: e.query, params: e.params, duration: e.duration }, 'Prisma Query');
  });

  prisma.$on('info', (e) => {
    logger.info(e.message);
  });

  prisma.$on('warn', (e) => {
    logger.warn(e.message);
  });

  prisma.$on('error', (e) => {
    logger.error(e.message);
  });
}
