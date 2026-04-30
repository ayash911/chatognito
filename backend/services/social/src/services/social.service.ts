import { prisma } from '@common/db/prisma';
import { logger } from '@chatognito/logger';

export class SocialService {
  /**
   * Follow a user
   */
  static async followUser(followerId: string, followingId: string) {
    logger.info({ followerId, followingId }, 'Attempting to follow user');
    if (followerId === followingId) throw new Error('CANNOT_FOLLOW_SELF');

    // Check if target user exists
    const target = await prisma.user.findUnique({ where: { id: followingId, deletedAt: null } });
    if (!target) {
      logger.warn({ followingId }, 'Follow failed: Target user not found');
      throw new Error('USER_NOT_FOUND');
    }

    // Check if already following
    const existing = await prisma.follow.findUnique({
      where: {
        followerId_followingId: { followerId, followingId },
      },
    });
    if (existing) {
      logger.warn({ followerId, followingId }, 'Follow failed: Already following');
      throw new Error('ALREADY_FOLLOWING');
    }

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

    const follow = await prisma.follow.create({
      data: { followerId, followingId },
    });
    logger.info({ followerId, followingId }, 'Followed user successfully');
    return follow;
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
    logger.info({ blockerId, blockedId }, 'Attempting to block user');
    if (blockerId === blockedId) throw new Error('CANNOT_BLOCK_SELF');

    // Check if target user exists
    const target = await prisma.user.findUnique({ where: { id: blockedId, deletedAt: null } });
    if (!target) {
      logger.warn({ blockedId }, 'Block failed: Target user not found');
      throw new Error('USER_NOT_FOUND');
    }

    // Check if already blocked
    const existing = await prisma.block.findUnique({
      where: {
        blockerId_blockedId: { blockerId, blockedId },
      },
    });
    if (existing) {
      logger.warn({ blockerId, blockedId }, 'Block failed: Already blocked');
      throw new Error('ALREADY_BLOCKED');
    }

    // Transaction: Block + Unfollow (both ways)
    const block = await prisma.$transaction(async (tx) => {
      // 1. Create block
      const b = await tx.block.create({
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

      return b;
    });

    logger.info({ blockerId, blockedId }, 'Blocked user successfully and removed mutual follows');
    return block;
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

  /**
   * Discovery V1: Suggest users based on mutual follows (friends of friends).
   */
  static async getSuggestions(userId: string, limit = 10) {
    const blocks = await prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    });
    const blockedIds = new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]));

    const following = await prisma.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });
    const followingIds = new Set(following.map((f) => f.followingId));

    const fof = await prisma.follow.findMany({
      where: {
        followerId: { in: Array.from(followingIds) },
        followingId: {
          notIn: [...Array.from(followingIds), userId, ...Array.from(blockedIds)],
        },
      },
      select: { followingId: true },
    });

    const suggestionsCount: Record<string, number> = {};
    for (const f of fof) {
      suggestionsCount[f.followingId] = (suggestionsCount[f.followingId] || 0) + 1;
    }

    const sortedIds = Object.entries(suggestionsCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map((entry) => entry[0]);

    if (sortedIds.length === 0) {
      // Fallback: random public users
      return prisma.user.findMany({
        where: {
          isPrivate: false,
          deletedAt: null,
          id: { notIn: [...Array.from(followingIds), userId, ...Array.from(blockedIds)] },
        },
        take: limit,
        select: { id: true, username: true, displayName: true, avatarUrl: true },
      });
    }

    const users = await prisma.user.findMany({
      where: { id: { in: sortedIds }, deletedAt: null },
      select: { id: true, username: true, displayName: true, avatarUrl: true },
    });

    return sortedIds.map((id) => users.find((u) => u.id === id)).filter(Boolean);
  }
}
