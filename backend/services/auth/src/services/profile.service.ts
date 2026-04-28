import { prisma } from '../db/prisma';

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
    return await prisma.user.update({
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
  }

  /**
   * Deactivate user account (Soft Delete)
   */
  static async deactivateAccount(userId: string) {
    return await prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  /**
   * Get public profile by username
   */
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
}
