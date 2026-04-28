import { Router, Request, Response } from 'express';
import { UsernameService } from '../services/username.service';
import { ProfileService } from '../services/profile.service';
import { prisma } from '../db/prisma';
import { AuthRequest, requireAuth } from '../middlewares/auth.middleware';
import { z } from 'zod';

export const userRouter = Router();

// Get public profile (Must be before specific /me routes if we used simple parameter routes, but /me is safe if handled carefully, though here /:username could conflict with /me if not ordered correctly. Since /me is under /me, we are fine, wait, /:username matches /me! We should handle that or put /me before /:username.)
// Wait, the routes are:
// /api/v1/users/me/username
// /api/v1/users/me/username/history
// /api/v1/users/me
// /api/v1/users/:username
// We must define /me routes before /:username.

const profileUpdateSchema = z.object({
  displayName: z.string().max(100).optional(),
  bio: z.string().max(1000).optional(),
  avatarUrl: z.string().url().max(1024).optional(),
  bannerUrl: z.string().url().max(1024).optional(),
  isPrivate: z.boolean().optional(),
});

// Update profile
userRouter.patch('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  const data = profileUpdateSchema.parse(req.body);
  const user = await ProfileService.updateProfile(req.user!.userId, data);
  res.json(user);
});

// Deactivate account
userRouter.delete('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  await ProfileService.deactivateAccount(req.user!.userId);
  res.json({ success: true, message: 'ACCOUNT_DEACTIVATED' });
});

// Update username
userRouter.put('/me/username', requireAuth, async (req: AuthRequest, res: Response) => {
  const { username } = req.body;
  const userId = req.user!.userId;

  if (!username) {
    return res.status(400).json({ error: 'USERNAME_REQUIRED' });
  }

  const cooldownEndsAt = await UsernameService.setUsername(userId, username);
  res.status(200).json({ message: 'Username updated successfully.', cooldownEndsAt });
});

// Get username history
userRouter.get('/me/username/history', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const history = await prisma.usernameHistory.findMany({
    where: { userId },
    orderBy: { changedAt: 'desc' },
  });
  res.status(200).json(history);
});

// Enable 2FA (Mock)
userRouter.post('/me/2fa/enable', requireAuth, async (req: AuthRequest, res: Response) => {
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

// Get public profile (Must be last to avoid catching /me)
userRouter.get('/:username', async (req: Request, res: Response) => {
  const profile = await ProfileService.getPublicProfile(req.params.username);
  res.json(profile);
});
