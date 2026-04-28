import { AuthService } from '@auth/services/auth.service';
import { prisma } from '@common/db/prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

jest.mock('@common/db/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}));

jest.mock('bcryptjs', () => ({
  genSalt: jest.fn().mockResolvedValue('salt'),
  hash: jest.fn().mockResolvedValue('hashed_password'),
  compare: jest.fn(),
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mock_token'),
}));

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('signup', () => {
    it('should throw EMAIL_IN_USE if user already exists', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({ id: '1' });
      await expect(AuthService.signup('test@example.com', 'password')).rejects.toThrow(
        'EMAIL_IN_USE',
      );
    });

    it('should create a new user if email is free', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(null);
      (prisma.user.create as jest.Mock).mockResolvedValueOnce({
        id: '1',
        email: 'test@example.com',
      });

      const result = await AuthService.signup('test@example.com', 'password');
      expect(result).toEqual({ id: '1', email: 'test@example.com' });
      expect(bcrypt.hash).toHaveBeenCalledWith('password', 'salt');
    });
  });

  describe('login', () => {
    it('should throw INVALID_CREDENTIALS if user does not exist', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(null);
      await expect(AuthService.login('test@example.com', 'password')).rejects.toThrow(
        'INVALID_CREDENTIALS',
      );
    });

    it('should throw INVALID_CREDENTIALS if password hash is missing', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        email: 'test@example.com',
        passwordHash: null,
      });
      await expect(AuthService.login('test@example.com', 'password')).rejects.toThrow(
        'INVALID_CREDENTIALS',
      );
    });

    it('should throw INVALID_CREDENTIALS if password does not match', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        email: 'test@example.com',
        passwordHash: 'hashed',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);
      await expect(AuthService.login('test@example.com', 'password')).rejects.toThrow(
        'INVALID_CREDENTIALS',
      );
    });

    it('should throw ACCOUNT_DELETED if user is soft-deleted', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
        email: 'test@example.com',
        passwordHash: 'hashed',
        deletedAt: new Date(),
      });
      await expect(AuthService.login('test@example.com', 'password')).rejects.toThrow(
        'ACCOUNT_DELETED',
      );
    });

    it('should return token and user data on successful login', async () => {
      const mockUser = {
        id: '1',
        email: 'test@example.com',
        passwordHash: 'hashed',
        username: 'testuser',
      };
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

      const result = await AuthService.login('test@example.com', 'password');

      expect(result).toHaveProperty('token', 'mock_token');
      expect(result.user).toEqual({ id: '1', email: 'test@example.com', username: 'testuser' });
      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ userId: '1', email: 'test@example.com', hasUsername: true }),
        expect.any(String),
        { expiresIn: '7d' },
      );
    });
  });
});
