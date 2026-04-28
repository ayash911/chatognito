import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/prisma';
import { User } from '@chatognito/database';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretfallback'; // In production, this must be set

export class AuthService {
  static async signup(email: string, passwordHash: string) {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
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

    return { id: user.id, email: user.email };
  }

  static async login(email: string, passwordHash: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      throw new Error('INVALID_CREDENTIALS');
    }

    const isValid = await bcrypt.compare(passwordHash, user.passwordHash);
    if (!isValid) {
      throw new Error('INVALID_CREDENTIALS');
    }

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
