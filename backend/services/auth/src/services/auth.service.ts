import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '@common/db/prisma';
import { User } from '@chatognito/database';
import { logger } from '@chatognito/logger';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretfallback'; // In production, this must be set

export class AuthService {
  static async signup(email: string, passwordHash: string) {
    logger.info({ email }, 'Attempting signup');
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      logger.warn({ email }, 'Signup failed: Email already in use');
      throw new Error('EMAIL_IN_USE');
    }

    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(passwordHash, salt);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: hashed,
      },
    });

    logger.info({ userId: user.id, email }, 'User signed up successfully');
    return { id: user.id, email: user.email };
  }

  static async login(email: string, passwordHash: string) {
    logger.info({ email }, 'Attempting login');
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      logger.warn({ email }, 'Login failed: Invalid credentials');
      throw new Error('INVALID_CREDENTIALS');
    }

    if (user.deletedAt) {
      logger.warn({ email, userId: user.id }, 'Login failed: Account soft-deleted');
      throw new Error('ACCOUNT_DELETED');
    }

    const isValid = await bcrypt.compare(passwordHash, user.passwordHash);
    if (!isValid) {
      logger.warn({ email, userId: user.id }, 'Login failed: Password mismatch');
      throw new Error('INVALID_CREDENTIALS');
    }

    logger.info({ userId: user.id, email }, 'User logged in successfully');

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        hasUsername: !!user.username,
      },
      JWT_SECRET,
      { expiresIn: '7d' },
    );

    return { token, user: { id: user.id, email: user.email, username: user.username } };
  }

  /**
   * Helper for OAuth logins where password check is skipped
   */
  static async loginWithoutPassword(user: User) {
    const token = jwt.sign(
      { userId: user.id, email: user.email, hasUsername: !!user.username },
      JWT_SECRET,
      { expiresIn: '7d' },
    );

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
      },
    };
  }
}
