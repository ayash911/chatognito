import { Router, Request, Response } from 'express';
import { UsernameService } from '../services/username.service';
import { ProfileService } from '../services/profile.service';
import { prisma } from '@common/db/prisma';
import { AuthRequest, requireAuth } from '../middlewares/auth.middleware';
import { requireOwnership } from '../middlewares/ownership.middleware';
import { z } from 'zod';

export const profileRouter = Router();

const profileUpdateSchema = z.object({
  displayName: z.string().max(100).optional(),
  bio: z.string().max(1000).optional(),
  avatarUrl: z.string().url().max(1024).optional(),
  bannerUrl: z.string().url().max(1024).optional(),
  isPrivate: z.boolean().optional(),
});

// Update profile
profileRouter.patch('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  const data = profileUpdateSchema.parse(req.body);
  const user = await ProfileService.updateProfile(req.user!.userId, data);
  res.json(user);
});

// Deactivate account (Self)
profileRouter.delete('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  await ProfileService.deactivateAccount(req.user!.userId);
  res.json({ success: true, message: 'ACCOUNT_DEACTIVATED' });
});

// Deactivate account (Admin/Moderator or Self via ID)
profileRouter.delete(
  '/:userId',
  requireAuth,
  requireOwnership('userId'),
  async (req: AuthRequest, res: Response) => {
    await ProfileService.deactivateAccount(req.params.userId);
    res.json({ success: true, message: 'ACCOUNT_DEACTIVATED' });
  },
);

// Update username
profileRouter.put('/me/username', requireAuth, async (req: AuthRequest, res: Response) => {
  const { username } = req.body;
  const userId = req.user!.userId;

  if (!username) {
    return res.status(400).json({ error: 'USERNAME_REQUIRED' });
  }

  const cooldownEndsAt = await UsernameService.setUsername(userId, username);
  res.status(200).json({ message: 'Username updated successfully.', cooldownEndsAt });
});

// Get username history
profileRouter.get('/me/username/history', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const history = await prisma.usernameHistory.findMany({
    where: { userId },
    orderBy: { changedAt: 'desc' },
  });
  res.status(200).json(history);
});

// Enable 2FA (Mock)
profileRouter.post('/me/2fa/enable', requireAuth, async (req: AuthRequest, res: Response) => {
  const secret = 'MOCK_SECRET_' + Math.random().toString(36).substring(7);
  await prisma.user.update({
    where: { id: req.user!.userId },
    data: {
      twoFactorSecret: secret,
      twoFactorEnabled: true,
    },
  });
  res.json({ success: true, secret });
});

// Search users
profileRouter.get('/search', requireAuth, async (req: AuthRequest, res: Response) => {
  const query = req.query.q as string;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;

  if (!query) {
    return res.status(400).json({ error: 'QUERY_REQUIRED' });
  }

  const users = await ProfileService.search(query, limit);
  res.json(users);
});

// Get public profile (Must be last to avoid catching /me or /search)
profileRouter.get('/:username', async (req: Request, res: Response) => {
  const profile = await ProfileService.getPublicProfile(req.params.username);
  res.json(profile);
});
