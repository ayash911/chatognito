import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';

export const requireRole = (roles: ('user' | 'moderator' | 'admin')[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'UNAUTHORIZED' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'FORBIDDEN_ROLE_REQUIRED' });
    }

    next();
  };
};

export const isAdmin = requireRole(['admin']);
export const isModerator = requireRole(['moderator', 'admin']);
