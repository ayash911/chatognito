import { prisma } from '@common/db/prisma';
import { logger } from '@chatognito/logger';

export interface CreatePostData {
  content: string;
  visibility?: 'public' | 'followers' | 'private';
  media?: Array<{
    type: 'image' | 'video';
    url: string;
    metadata?: any;
  }>;
}

export class PostService {
  /**
   * Creates a new post with optional media attachments.
   */
  static async createPost(authorId: string, data: CreatePostData) {
    logger.info({ authorId }, 'Attempting to create post');

    const post = await prisma.post.create({
      data: {
        authorId,
        content: data.content,
        visibility: data.visibility || 'public',
        media: data.media
          ? {
              create: data.media.map((m) => ({
                type: m.type,
                url: m.url,
                metadata: m.metadata || {},
              })),
            }
          : undefined,
      },
      include: {
        author: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
        media: true,
      },
    });

    logger.info({ postId: post.id, authorId }, 'Post created successfully');
    return post;
  }

  /**
   * Retrieves a single post by ID, enforcing privacy and block rules.
   */
  static async getPost(postId: string, viewerId?: string) {
    const post = await prisma.post.findUnique({
      where: { id: postId, deletedAt: null },
      include: {
        author: {
          select: { id: true, username: true, displayName: true, avatarUrl: true, isPrivate: true },
        },
        media: true,
        _count: {
          select: {
            likes: true,
            comments: true,
          },
        },
      },
    });

    if (!post) throw new Error('POST_NOT_FOUND');

    // If viewerId is provided, check access
    if (viewerId) {
      await this.checkAccess(viewerId, post.authorId, post.visibility, post.author.isPrivate);
    } else if (post.visibility !== 'public' || post.author.isPrivate) {
      // Unauthenticated users can only see public posts from public accounts
      throw new Error('FORBIDDEN');
    }

    return post;
  }

  /**
   * Internal helper to check if a viewer can access an author's content.
   */
  private static async checkAccess(
    viewerId: string,
    authorId: string,
    visibility: 'public' | 'followers' | 'private',
    authorIsPrivate: boolean,
  ) {
    if (viewerId === authorId) return;

    // 1. Check blocks
    const block = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: authorId },
          { blockerId: authorId, blockedId: viewerId },
        ],
      },
    });
    if (block) throw new Error('FORBIDDEN');

    // 2. Check visibility
    if (visibility === 'private') throw new Error('FORBIDDEN');

    // 3. Check followers logic
    const follow = await prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: viewerId, followingId: authorId } },
    });

    if (visibility === 'followers' && !follow) {
      throw new Error('FORBIDDEN');
    }

    if (authorIsPrivate && !follow) {
      throw new Error('FORBIDDEN');
    }
  }

  /**
   * Soft-deletes a post. Only the author can delete their own post.
   */
  static async deletePost(authorId: string, postId: string) {
    logger.info({ authorId, postId }, 'Attempting to delete post');

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, authorId: true, deletedAt: true },
    });

    if (!post || post.deletedAt) throw new Error('POST_NOT_FOUND');

    if (post.authorId !== authorId) {
      throw new Error('FORBIDDEN');
    }

    await prisma.post.update({
      where: { id: postId },
      data: { deletedAt: new Date() },
    });

    logger.info({ postId, authorId }, 'Post soft-deleted successfully');
  }

  /**
   * Likes a post.
   */
  static async likePost(userId: string, postId: string) {
    const post = await prisma.post.findUnique({
      where: { id: postId, deletedAt: null },
      include: { author: { select: { isPrivate: true } } },
    });
    if (!post) throw new Error('POST_NOT_FOUND');

    await this.checkAccess(userId, post.authorId, post.visibility, post.author.isPrivate);

    await prisma.postLike.upsert({
      where: { postId_userId: { postId, userId } },
      create: { postId, userId },
      update: {},
    });
  }

  /**
   * Unlikes a post.
   */
  static async unlikePost(userId: string, postId: string) {
    await prisma.postLike.deleteMany({
      where: { postId, userId },
    });
  }

  /**
   * Adds a comment to a post.
   */
  static async addComment(authorId: string, postId: string, content: string, parentId?: string) {
    const post = await prisma.post.findUnique({
      where: { id: postId, deletedAt: null },
      include: { author: { select: { isPrivate: true } } },
    });
    if (!post) throw new Error('POST_NOT_FOUND');

    await this.checkAccess(authorId, post.authorId, post.visibility, post.author.isPrivate);

    if (parentId) {
      const parent = await prisma.postComment.findUnique({ where: { id: parentId } });
      if (!parent || parent.deletedAt) throw new Error('COMMENT_NOT_FOUND');
    }

    return prisma.postComment.create({
      data: {
        postId,
        authorId,
        content,
        parentId,
      },
      include: {
        author: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });
  }

  /**
   * Lists comments for a post, enforcing privacy rules.
   */
  static async listComments(postId: string, viewerId?: string) {
    const post = await prisma.post.findUnique({
      where: { id: postId, deletedAt: null },
      include: { author: { select: { isPrivate: true } } },
    });
    if (!post) throw new Error('POST_NOT_FOUND');

    if (viewerId) {
      await this.checkAccess(viewerId, post.authorId, post.visibility, post.author.isPrivate);
    } else if (post.visibility !== 'public' || post.author.isPrivate) {
      throw new Error('FORBIDDEN');
    }

    return prisma.postComment.findMany({
      where: { postId, deletedAt: null, parentId: null }, // Top level comments
      include: {
        author: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
        replies: {
          include: {
            author: {
              select: { id: true, username: true, displayName: true, avatarUrl: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Soft-deletes a comment. Only the author can delete it.
   */
  static async deleteComment(authorId: string, commentId: string) {
    logger.info({ authorId, commentId }, 'Attempting to delete comment');

    const comment = await prisma.postComment.findUnique({
      where: { id: commentId },
    });

    if (!comment || comment.deletedAt) throw new Error('COMMENT_NOT_FOUND');

    if (comment.authorId !== authorId) {
      throw new Error('FORBIDDEN');
    }

    await prisma.postComment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });

    logger.info({ commentId, authorId }, 'Comment soft-deleted successfully');
  }

  /**
   * Generates a feed for a user, respecting privacy and blocks.
   */
  static async getFeed(userId: string, limit = 20, cursor?: string) {
    // 1. Get users we follow
    const following = await prisma.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });
    const followingIds = following.map((f) => f.followingId);

    // 2. Get users involved in blocks (either way)
    const blocks = await prisma.block.findMany({
      where: {
        OR: [{ blockerId: userId }, { blockedId: userId }],
      },
      select: { blockerId: true, blockedId: true },
    });
    const blockedIds = Array.from(new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId])));

    // 3. Construct the query
    // Rules:
    // - Never show posts from/to blocked users
    // - Show own posts (all)
    // - Show posts from followed users (public or followers visibility)
    // - Show public posts from non-followed public accounts
    const feed = await prisma.post.findMany({
      where: {
        deletedAt: null,
        authorId: {
          notIn: blockedIds.length > 0 ? blockedIds : undefined,
        },
        OR: [
          // 1. My own posts
          { authorId: userId },
          // 2. Posts from users I follow
          {
            authorId: { in: followingIds },
            visibility: { in: ['public', 'followers'] },
          },
          // 3. Public posts from non-followed public accounts
          {
            visibility: 'public',
            author: {
              isPrivate: false,
              id: {
                notIn: [...followingIds, userId],
              },
            },
          },
        ],
      },
      include: {
        author: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
        media: true,
        _count: {
          select: {
            likes: true,
            comments: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(cursor
        ? {
            skip: 1,
            cursor: { id: cursor },
          }
        : {}),
    });

    return feed;
  }
}
