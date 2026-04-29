import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';

/**
 * Ensures the logged-in user is the owner of the resource.
 * Adms and Moderators can bypass this check.
 */
export const requireOwnership = (paramName: string = 'userId') => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'UNAUTHORIZED' });

    const resourceUserId = req.params[paramName] || req.body[paramName];

    // Bypass for admins/moderators
    if (req.user.role === 'admin' || req.user.role === 'moderator') {
      return next();
    }

    if (req.user.userId !== resourceUserId) {
      return res.status(403).json({ error: 'FORBIDDEN_OWNERSHIP_REQUIRED' });
    }

    next();
  };
};
