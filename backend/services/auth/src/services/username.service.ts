import { redis } from '../db/redis';
import { prisma } from '../db/prisma';
import { Prisma } from '@chatognito/database';

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;
const COOLDOWN_DAYS = 90;

export class UsernameService {
  /**
   * Sets a username for a user, enforcing format, uniqueness, and the 90-day cooldown.
   * Uses Redis SETNX to prevent concurrent requests from reserving the same username.
   */
  static async setUsername(userId: string, desiredUsername: string): Promise<Date> {
    const username = desiredUsername.toLowerCase().trim();

    if (!USERNAME_REGEX.test(username)) {
      throw new Error(
        'INVALID_FORMAT: Username must be 3-20 characters, alphanumeric or underscores.',
      );
    }

    // 1. Acquire Distributed Lock
    const lockKey = `lock:username:${username}`;
    // PX 5000 = 5 seconds TTL. NX = Only set if not exists.
    const lockAcquired = await redis.set(lockKey, 'locked', 'PX', 5000, 'NX');

    if (!lockAcquired) {
      throw new Error('USERNAME_TAKEN_OR_PENDING');
    }

    try {
      // 2. Perform Transaction in PostgreSQL
      return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Fetch user with row-level lock
        const user = await tx.$queryRaw<any[]>`
          SELECT username, username_last_changed_at 
          FROM users 
          WHERE id = ${userId}::uuid 
          FOR UPDATE
        `;

        if (!user || user.length === 0) {
          throw new Error('USER_NOT_FOUND');
        }

        const currentUser = user[0];

        // Check Cooldown
        if (currentUser.username_last_changed_at) {
          const daysSinceChange =
            (Date.now() - new Date(currentUser.username_last_changed_at).getTime()) /
            (1000 * 60 * 60 * 24);
          if (daysSinceChange < COOLDOWN_DAYS) {
            throw new Error('COOLDOWN_ACTIVE');
          }
        }

        // Check Uniqueness (double check despite lock)
        const existing = await tx.user.findUnique({
          where: { username },
        });

        if (existing && existing.id !== userId) {
          throw new Error('USERNAME_TAKEN');
        }

        const now = new Date();

        // Track History if changing from an old username
        if (currentUser.username && currentUser.username !== username) {
          await tx.usernameHistory.create({
            data: {
              userId,
              oldUsername: currentUser.username,
            },
          });
        }

        // Update Username
        await tx.user.update({
          where: { id: userId },
          data: {
            username,
            usernameLastChangedAt: now,
          },
        });

        // Calculate next change date
        const nextChangeDate = new Date(now);
        nextChangeDate.setDate(nextChangeDate.getDate() + COOLDOWN_DAYS);
        return nextChangeDate;
      });
    } finally {
      // 3. Release Redis Lock
      await redis.del(lockKey);
    }
  }
}
