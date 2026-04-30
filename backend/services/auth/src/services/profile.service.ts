import { prisma } from '@common/db/prisma';
import { logger } from '@chatognito/logger';

export class ProfileService {
  /**
   * Update user profile information
   */
  static async updateProfile(
    userId: string,
    data: {
      displayName?: string;
      bio?: string;
      avatarUrl?: string;
      bannerUrl?: string;
      isPrivate?: boolean;
    },
  ) {
    logger.info({ userId }, 'Updating user profile');
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...data,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        bio: true,
        avatarUrl: true,
        bannerUrl: true,
        isPrivate: true,
        createdAt: true,
      },
    });
    logger.info({ userId }, 'User profile updated successfully');
    return user;
  }

  static async deactivateAccount(userId: string) {
    return await prisma.user.delete({
      where: { id: userId },
    });
  }

  static async getProfile(identifier: string) {
    logger.info({ identifier }, 'Fetching user profile');
    const user = await prisma.user.findUnique({
      where: { username: identifier },
      select: {
        id: true,
        username: true,
        displayName: true,
        bio: true,
        avatarUrl: true,
        bannerUrl: true,
        isPrivate: true,
        createdAt: true,
      },
    });

    if (!user) throw new Error('USER_NOT_FOUND');
    if (user.isPrivate) {
      return {
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        isPrivate: true,
      };
    }

    return user;
  }

  static async getPublicProfile(username: string) {
    const user = await prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        displayName: true,
        bio: true,
        avatarUrl: true,
        bannerUrl: true,
        isPrivate: true,
        createdAt: true,
      },
    });

    if (!user) throw new Error('USER_NOT_FOUND');
    if (user.isPrivate) {
      return {
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        isPrivate: true,
      };
    }

    return user;
  }

  /**
   * Search for users by username or display name
   */
  static async search(query: string, limit = 10) {
    logger.info({ query }, 'Searching for users');
    return await prisma.user.findMany({
      where: {
        deletedAt: null,
        OR: [
          { username: { contains: query, mode: 'insensitive' } },
          { displayName: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
      },
      take: limit,
    });
  }

  /**
   * Blind Hashing: search public users by hashed email/phone.
   * Assumes PostgreSQL pgcrypto is installed for 'digest'.
   */
  static async searchByHash(hashes: string[]) {
    if (!hashes || hashes.length === 0) return [];

    // Attempting to install pgcrypto if it doesn't exist
    try {
      await prisma.$executeRaw`CREATE EXTENSION IF NOT EXISTS pgcrypto;`;
    } catch (e) {
      logger.warn('Failed to ensure pgcrypto extension is installed', e);
    }

    try {
      // Hashed emails must be lowercase SHA256 hex strings
      const result = await prisma.$queryRaw`
        SELECT id, username, display_name as "displayName", avatar_url as "avatarUrl"
        FROM users
        WHERE encode(digest(email, 'sha256'), 'hex') = ANY(${hashes}::text[])
        AND deleted_at IS NULL
        AND is_private = false
      `;
      return result;
    } catch (e) {
      logger.error('Blind hashing search failed', e);
      return [];
    }
  }
}
