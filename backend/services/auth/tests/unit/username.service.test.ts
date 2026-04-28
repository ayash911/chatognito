import { UsernameService } from '../../src/services/username.service';
import { redis } from '../../src/db/redis';
import { prisma } from '../../src/db/prisma';

jest.mock('../../src/db/redis', () => ({
  redis: {
    set: jest.fn(),
    del: jest.fn(),
  },
}));

jest.mock('../../src/db/prisma', () => ({
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

      let updatedData!: { data: { username: string } };

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

    it('should be case-insensitive and trim input', async () => {
      (redis.set as jest.Mock).mockResolvedValueOnce('OK');
      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (callback) => {
        const mockTx = {
          $queryRaw: jest
            .fn()
            .mockResolvedValueOnce([{ username: null, username_last_changed_at: null }]),
          user: {
            findUnique: jest.fn().mockResolvedValueOnce(null),
            update: jest.fn().mockResolvedValue({}),
          },
        };
        return callback(mockTx);
      });

      await UsernameService.setUsername('user-1', '  New_User  ');
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining('new_user'),
        'locked',
        'PX',
        5000,
        'NX',
      );
    });

    it('should throw INVALID_FORMAT for length boundaries', async () => {
      await expect(UsernameService.setUsername('user-1', 'ab')).rejects.toThrow('INVALID_FORMAT');
      await expect(UsernameService.setUsername('user-1', 'a'.repeat(21))).rejects.toThrow(
        'INVALID_FORMAT',
      );

      // Should pass length check for 3 and 20
      (redis.set as jest.Mock).mockResolvedValue(null); // Just to stop execution after format check
      await expect(UsernameService.setUsername('user-1', 'abc')).rejects.toThrow(
        'USERNAME_TAKEN_OR_PENDING',
      );
      await expect(UsernameService.setUsername('user-1', 'a'.repeat(20))).rejects.toThrow(
        'USERNAME_TAKEN_OR_PENDING',
      );
    });

    it('should throw INVALID_FORMAT for special characters', async () => {
      await expect(UsernameService.setUsername('user-1', 'user@name')).rejects.toThrow(
        'INVALID_FORMAT',
      );
      await expect(UsernameService.setUsername('user-1', 'user.name')).rejects.toThrow(
        'INVALID_FORMAT',
      );
      await expect(UsernameService.setUsername('user-1', 'user!name')).rejects.toThrow(
        'INVALID_FORMAT',
      );
    });

    it('should throw USERNAME_TAKEN if another user has the username', async () => {
      (redis.set as jest.Mock).mockResolvedValueOnce('OK');
      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (callback) => {
        const mockTx = {
          $queryRaw: jest
            .fn()
            .mockResolvedValueOnce([{ username: null, username_last_changed_at: null }]),
          user: {
            findUnique: jest.fn().mockResolvedValueOnce({ id: 'other-user' }),
          },
        };
        return callback(mockTx);
      });

      await expect(UsernameService.setUsername('user-1', 'taken_name')).rejects.toThrow(
        'USERNAME_TAKEN',
      );
    });

    it('should throw USER_NOT_FOUND if user does not exist', async () => {
      (redis.set as jest.Mock).mockResolvedValueOnce('OK');
      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (callback) => {
        const mockTx = {
          $queryRaw: jest.fn().mockResolvedValueOnce([]),
        };
        return callback(mockTx);
      });

      await expect(UsernameService.setUsername('user-1', 'valid_name')).rejects.toThrow(
        'USER_NOT_FOUND',
      );
    });

    it('should not create username history on first time setup', async () => {
      (redis.set as jest.Mock).mockResolvedValueOnce('OK');
      const createHistorySpy = jest.fn();

      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (callback) => {
        const mockTx = {
          $queryRaw: jest
            .fn()
            .mockResolvedValueOnce([{ username: null, username_last_changed_at: null }]),
          user: {
            findUnique: jest.fn().mockResolvedValueOnce(null),
            update: jest.fn().mockResolvedValue({}),
          },
          usernameHistory: {
            create: createHistorySpy,
          },
        };
        return callback(mockTx);
      });

      await UsernameService.setUsername('user-1', 'first_name');
      expect(createHistorySpy).not.toHaveBeenCalled();
    });

    it('should allow changing username if exactly 90 days have passed', async () => {
      (redis.set as jest.Mock).mockResolvedValueOnce('OK');
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      (prisma.$transaction as jest.Mock).mockImplementationOnce(async (callback) => {
        const mockTx = {
          $queryRaw: jest
            .fn()
            .mockResolvedValueOnce([{ username: 'old', username_last_changed_at: ninetyDaysAgo }]),
          user: {
            findUnique: jest.fn().mockResolvedValueOnce(null),
            update: jest.fn().mockResolvedValue({}),
          },
          usernameHistory: {
            create: jest.fn(),
          },
        };
        return callback(mockTx);
      });

      const nextChangeDate = await UsernameService.setUsername('user-1', 'exact_90_days');
      expect(nextChangeDate.getTime()).toBeGreaterThan(Date.now());
    });
  });
});
