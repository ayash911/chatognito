import { PostService } from '../../../content/src/services/post.service';
import { prisma } from '@common/db/prisma';

jest.mock('@common/db/prisma', () => ({
  prisma: {
    post: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    postLike: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    postComment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    block: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    follow: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}));

describe('PostService', () => {
  const mockUserId = 'user-1';
  const mockPostId = 'post-1';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createPost', () => {
    it('should create a post with media', async () => {
      const data = {
        content: 'Hello',
        media: [{ type: 'image' as const, url: 'http://image.com' }],
      };
      (prisma.post.create as jest.Mock).mockResolvedValueOnce({ id: mockPostId, ...data });

      const result = await PostService.createPost(mockUserId, data);
      expect(result.id).toBe(mockPostId);
      expect(prisma.post.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: 'Hello',
            media: {
              create: [expect.objectContaining({ type: 'image', url: 'http://image.com' })],
            },
          }),
        }),
      );
    });
  });

  describe('getPost', () => {
    it('should return post with counts', async () => {
      (prisma.post.findUnique as jest.Mock).mockResolvedValueOnce({
        id: mockPostId,
        author: { isPrivate: false },
        visibility: 'public',
        _count: { likes: 5, comments: 2 },
      });

      const result = await PostService.getPost(mockPostId);
      expect(result._count.likes).toBe(5);
    });

    it('should throw POST_NOT_FOUND if missing', async () => {
      (prisma.post.findUnique as jest.Mock).mockResolvedValueOnce(null);
      await expect(PostService.getPost(mockPostId)).rejects.toThrow('POST_NOT_FOUND');
    });
  });

  describe('deletePost', () => {
    it('should throw FORBIDDEN if author mismatch', async () => {
      (prisma.post.findUnique as jest.Mock).mockResolvedValueOnce({
        id: mockPostId,
        authorId: 'other-user',
      });
      await expect(PostService.deletePost(mockUserId, mockPostId)).rejects.toThrow('FORBIDDEN');
    });

    it('should soft-delete if author matches', async () => {
      (prisma.post.findUnique as jest.Mock).mockResolvedValueOnce({
        id: mockPostId,
        authorId: mockUserId,
      });
      await PostService.deletePost(mockUserId, mockPostId);
      expect(prisma.post.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockPostId },
          data: { deletedAt: expect.any(Date) },
        }),
      );
    });
  });

  describe('likePost', () => {
    it('should throw POST_NOT_FOUND if post is missing', async () => {
      (prisma.post.findUnique as jest.Mock).mockResolvedValueOnce(null);
      await expect(PostService.likePost(mockUserId, mockPostId)).rejects.toThrow('POST_NOT_FOUND');
    });

    it('should upsert like', async () => {
      (prisma.post.findUnique as jest.Mock).mockResolvedValueOnce({
        id: mockPostId,
        authorId: 'author-1',
        author: { isPrivate: false },
        visibility: 'public',
      });
      await PostService.likePost(mockUserId, mockPostId);
      expect(prisma.postLike.upsert).toHaveBeenCalled();
    });
  });

  describe('addComment', () => {
    it('should throw COMMENT_NOT_FOUND if parent missing', async () => {
      (prisma.post.findUnique as jest.Mock).mockResolvedValueOnce({
        id: mockPostId,
        authorId: 'author-1',
        author: { isPrivate: false },
        visibility: 'public',
      });
      (prisma.postComment.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        PostService.addComment(mockUserId, mockPostId, 'Hi', 'parent-1'),
      ).rejects.toThrow('COMMENT_NOT_FOUND');
    });

    it('should create comment', async () => {
      (prisma.post.findUnique as jest.Mock).mockResolvedValueOnce({
        id: mockPostId,
        authorId: 'author-1',
        author: { isPrivate: false },
        visibility: 'public',
      });
      (prisma.postComment.create as jest.Mock).mockResolvedValueOnce({ id: 'c1' });

      const result = await PostService.addComment(mockUserId, mockPostId, 'Hi');
      expect(result.id).toBe('c1');
    });
  });
});
