import { prisma } from '@common/db/prisma';

export class SocialService {
  /**
   * Follow a user
   */
  static async followUser(followerId: string, followingId: string) {
    if (followerId === followingId) throw new Error('CANNOT_FOLLOW_SELF');

    // Check if target user exists
    const target = await prisma.user.findUnique({ where: { id: followingId, deletedAt: null } });
    if (!target) throw new Error('USER_NOT_FOUND');

    // Check if already following
    const existing = await prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId, followingId },
      },
    });
    if (existing) throw new Error('ALREADY_FOLLOWING');

    // Check if blocked (either way)
    const block = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: followerId, blockedId: followingId },
          { blockerId: followingId, blockedId: followerId },
        ],
      },
    });
    if (block) throw new Error('FORBIDDEN');

    return prisma.follow.create({
      data: { followerId, followingId },
    });
  }

  /**
   * Unfollow a user
   */
  static async unfollowUser(followerId: string, followingId: string) {
    const existing = await prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId, followingId },
      },
    });
    if (!existing) throw new Error('NOT_FOLLOWING');

    return prisma.follow.delete({
      where: { id: existing.id },
    });
  }

  /**
   * Block a user
   */
  static async blockUser(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) throw new Error('CANNOT_BLOCK_SELF');

    // Check if target user exists
    const target = await prisma.user.findUnique({ where: { id: blockedId, deletedAt: null } });
    if (!target) throw new Error('USER_NOT_FOUND');

    // Check if already blocked
    const existing = await prisma.block.findUnique({
      where: {
        blockerId_blockedId: { blockerId, blockedId },
      },
    });
    if (existing) throw new Error('ALREADY_BLOCKED');

    // Transaction: Block + Unfollow (both ways)
    return prisma.$transaction(async (tx) => {
      // 1. Create block
      const block = await tx.block.create({
        data: { blockerId, blockedId },
      });

      // 2. Remove any follows (both ways)
      await tx.follow.deleteMany({
        where: {
          OR: [
            { followerId: blockerId, followingId: blockedId },
            { followerId: blockedId, followingId: blockerId },
          ],
        },
      });

      return block;
    });
  }

  /**
   * Unblock a user
   */
  static async unblockUser(blockerId: string, blockedId: string) {
    const existing = await prisma.block.findUnique({
      where: {
        blockerId_blockedId: { blockerId, blockedId },
      },
    });
    if (!existing) throw new Error('NOT_BLOCKED');

    return prisma.block.delete({
      where: { id: existing.id },
    });
  }

  /**
   * Get followers of a user
   */
  static async getFollowers(userId: string) {
    return prisma.follow.findMany({
      where: { followingId: userId },
      include: {
        follower: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });
  }

  /**
   * Get users followed by a user
   */
  static async getFollowing(userId: string) {
    return prisma.follow.findMany({
      where: { followerId: userId },
      include: {
        following: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });
  }

  /**
   * Get relationship status between two users
   */
  static async getRelationshipStatus(userId: string, targetId: string) {
    const [following, followedBy, blocking, blockedBy] = await Promise.all([
      prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: userId, followingId: targetId } },
      }),
      prisma.follow.findUnique({
        where: { followerId_followingId: { followerId: targetId, followingId: userId } },
      }),
      prisma.block.findUnique({
        where: { blockerId_blockedId: { blockerId: userId, blockedId: targetId } },
      }),
      prisma.block.findUnique({
        where: { blockerId_blockedId: { blockerId: targetId, blockedId: userId } },
      }),
    ]);

    return {
      isFollowing: !!following,
      isFollowedBy: !!followedBy,
      isBlocking: !!blocking,
      isBlockedBy: !!blockedBy,
      isFriend: !!following && !!followedBy,
    };
  }
}
