import { ProfileService } from '@auth/services/profile.service';
import { prisma } from '@common/db/prisma';

jest.mock('@common/db/prisma', () => ({
  prisma: {
    user: {
      update: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

describe('ProfileService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('updateProfile', () => {
    it('should update profile fields and return selected fields', async () => {
      const mockUser = { id: '1', email: 'test@example.com', displayName: 'New Name' };
      (prisma.user.update as jest.Mock).mockResolvedValueOnce(mockUser);

      const result = await ProfileService.updateProfile('1', { displayName: 'New Name' });

      expect(result).toEqual(mockUser);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: expect.objectContaining({ displayName: 'New Name' }),
        select: expect.any(Object),
      });
    });
  });

  describe('getPublicProfile', () => {
    it('should return limited info if profile is private', async () => {
      const mockUser = {
        id: '1',
        username: 'private_user',
        displayName: 'Secret',
        isPrivate: true,
        avatarUrl: 'img.jpg',
      };
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(mockUser);

      const result = await ProfileService.getPublicProfile('private_user');

      expect(result).toEqual({
        username: 'private_user',
        displayName: 'Secret',
        avatarUrl: 'img.jpg',
        isPrivate: true,
      });
      expect(result).not.toHaveProperty('id');
    });
  });
});
