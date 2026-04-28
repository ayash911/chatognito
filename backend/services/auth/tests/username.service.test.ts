import { UsernameService } from '../src/services/username.service';
import { redis } from '../src/db/redis';
import { prisma } from '../src/db/prisma';

jest.mock('../src/db/redis', () => ({
  redis: {
    set: jest.fn(),
    del: jest.fn(),
  },
}));

jest.mock('../src/db/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    user: {
      findUnique: jest.fn(),
    },
  },
}));

describe('UsernameService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('setUsername', () => {
    it('should throw INVALID_FORMAT if username is invalid', async () => {
      await expect(UsernameService.setUsername('user-1', 'ab')).rejects.toThrow('INVALID_FORMAT');
      await expect(UsernameService.setUsername('user-1', 'a b c')).rejects.toThrow(
        'INVALID_FORMAT',
      );
    });

    it('should throw USERNAME_TAKEN_OR_PENDING if lock cannot be acquired', async () => {
      (redis.set as jest.Mock).mockResolvedValueOnce(null); // Lock failed
      await expect(UsernameService.setUsername('user-1', 'valid_name')).rejects.toThrow(
        'USERNAME_TAKEN_OR_PENDING',
      );
    });

    it('should throw COOLDOWN_ACTIVE if changed within 90 days', async () => {
      (redis.set as jest.Mock).mockResolvedValueOnce('OK'); // Lock acquired

      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 10); // Changed 10 days ago

      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (callback) => {
        const mockTx = {
          $queryRaw: jest.fn().mockResolvedValueOnce([{ username_last_changed_at: recentDate }]),
        };
        return callback(mockTx);
      });

      await expect(UsernameService.setUsername('user-1', 'valid_name')).rejects.toThrow(
        'COOLDOWN_ACTIVE',
      );
      expect(redis.del).toHaveBeenCalled();
    });

    it('should successfully change username if valid and cooldown passed', async () => {
      (redis.set as jest.Mock).mockResolvedValueOnce('OK');

      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 95); // Changed 95 days ago

      let updatedData: any;

      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (callback) => {
        const mockTx = {
          $queryRaw: jest
            .fn()
            .mockResolvedValueOnce([{ username: 'old_name', username_last_changed_at: oldDate }]),
          user: {
            findUnique: jest.fn().mockResolvedValueOnce(null),
            update: jest.fn().mockImplementation((args) => {
              updatedData = args;
            }),
          },
          usernameHistory: {
            create: jest.fn(),
          },
        };
        return callback(mockTx);
      });

      const nextChangeDate = await UsernameService.setUsername('user-1', 'new_name');

      expect(updatedData.data.username).toBe('new_name');
      expect(nextChangeDate.getTime()).toBeGreaterThan(Date.now());
      expect(redis.del).toHaveBeenCalled();
    });
  });
});
