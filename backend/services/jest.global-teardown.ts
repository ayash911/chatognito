import { prisma } from './common/src/db/prisma';
import { redis } from './common/src/db/redis';

export default async function globalTeardown() {
  console.log('\nClosing database and redis connections...');
  try {
    await prisma.$disconnect();
    await redis.quit();
    console.log('Connections closed successfully.');
  } catch (err) {
    console.error('Error during global teardown:', err);
  }
}
