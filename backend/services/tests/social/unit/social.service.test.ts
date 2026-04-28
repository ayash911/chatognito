import { SocialService } from '@social/services/social.service';
import { prisma } from '@common/db/prisma';

jest.mock('@common/db/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), findMany: jest.fn() },
    follow: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    block: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(prisma)),
  },
}));

describe('SocialService Unit Tests', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('followUser', () => {
    it('should throw CANNOT_FOLLOW_SELF', async () => {
      await expect(SocialService.followUser('u1', 'u1')).rejects.toThrow('CANNOT_FOLLOW_SELF');
    });

    it('should throw USER_NOT_FOUND if target does not exist', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(SocialService.followUser('u1', 'u2')).rejects.toThrow('USER_NOT_FOUND');
    });

    it('should throw ALREADY_FOLLOWING if already exists', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u2' });
      (prisma.follow.findUnique as jest.Mock).mockResolvedValue({ id: 'f1' });
      await expect(SocialService.followUser('u1', 'u2')).rejects.toThrow('ALREADY_FOLLOWING');
    });

    it('should create a follow if valid', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u2' });
      (prisma.follow.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.block.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.follow.create as jest.Mock).mockResolvedValue({ id: 'f1' });

      const result = await SocialService.followUser('u1', 'u2');
      expect(result.id).toBe('f1');
      expect(prisma.follow.create).toHaveBeenCalledWith({
        data: { followerId: 'u1', followingId: 'u2' },
      });
    });
  });

  describe('blockUser', () => {
    it('should block and remove mutual follows in transaction', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u2' });
      (prisma.block.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.block.create as jest.Mock).mockResolvedValue({ id: 'b1' });

      await SocialService.blockUser('u1', 'u2');

      expect(prisma.block.create).toHaveBeenCalled();
      expect(prisma.follow.deleteMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { followerId: 'u1', followingId: 'u2' },
            { followerId: 'u2', followingId: 'u1' },
          ],
        },
      });
    });
  });

  describe('unfollowUser', () => {
    it('should throw NOT_FOLLOWING if follow does not exist', async () => {
      (prisma.follow.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(SocialService.unfollowUser('u1', 'u2')).rejects.toThrow('NOT_FOLLOWING');
    });

    it('should delete follow if exists', async () => {
      (prisma.follow.findUnique as jest.Mock).mockResolvedValue({ id: 'f1' });
      await SocialService.unfollowUser('u1', 'u2');
      expect(prisma.follow.delete).toHaveBeenCalledWith({ where: { id: 'f1' } });
    });
  });

  describe('unblockUser', () => {
    it('should throw NOT_BLOCKED if block does not exist', async () => {
      (prisma.block.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(SocialService.unblockUser('u1', 'u2')).rejects.toThrow('NOT_BLOCKED');
    });

    it('should delete block if exists', async () => {
      (prisma.block.findUnique as jest.Mock).mockResolvedValue({ id: 'b1' });
      await SocialService.unblockUser('u1', 'u2');
      expect(prisma.block.delete).toHaveBeenCalledWith({ where: { id: 'b1' } });
    });
  });

  describe('getFollowers', () => {
    it('should return a list of followers', async () => {
      const followers = [{ id: 'f1', follower: { username: 'user1' } }];
      (prisma.follow.findMany as jest.Mock).mockResolvedValue(followers);
      const result = await SocialService.getFollowers('u1');
      expect(result).toEqual(followers);
      expect(prisma.follow.findMany).toHaveBeenCalledWith({
        where: { followingId: 'u1' },
        include: expect.any(Object),
      });
    });
  });

  describe('getFollowing', () => {
    it('should return a list of followed users', async () => {
      const following = [{ id: 'f1', following: { username: 'user2' } }];
      (prisma.follow.findMany as jest.Mock).mockResolvedValue(following);
      const result = await SocialService.getFollowing('u1');
      expect(result).toEqual(following);
      expect(prisma.follow.findMany).toHaveBeenCalledWith({
        where: { followerId: 'u1' },
        include: expect.any(Object),
      });
    });
  });

  describe('getRelationshipStatus', () => {
    it('should identify friends (mutual follow)', async () => {
      (prisma.follow.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'f1' }) // following
        .mockResolvedValueOnce({ id: 'f2' }); // followedBy
      (prisma.block.findUnique as jest.Mock).mockResolvedValue(null);

      const status = await SocialService.getRelationshipStatus('u1', 'u2');
      expect(status.isFollowing).toBe(true);
      expect(status.isFollowedBy).toBe(true);
      expect(status.isFriend).toBe(true);
    });
  });
});
