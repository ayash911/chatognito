import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '@common/db/prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretfallback';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: 'user' | 'moderator' | 'admin';
  };
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      email: string;
    };

    // Edge Case: Phantom User Check & Role Fetch
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, role: true, deletedAt: true },
    });

    if (!user || user.deletedAt) {
      return res.status(401).json({ error: 'USER_REMOVED' });
    }

    req.user = {
      ...decoded,
      role: user.role as 'user' | 'moderator' | 'admin',
    };
    next();
  } catch (_err) {
    return res.status(401).json({ error: 'INVALID_TOKEN' });
  }
};
