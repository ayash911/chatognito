import { Router } from 'express';
import { requireAuth, AuthRequest } from '@auth/middlewares/auth.middleware';
import { SocialService } from '@social/services/social.service';

export const socialRouter = Router();

// All social routes require authentication
socialRouter.use(requireAuth);

// Follow / Unfollow
socialRouter.post('/follow/:userId', async (req: AuthRequest, res) => {
  const followerId = req.user!.userId;
  const followingId = req.params.userId;
  await SocialService.followUser(followerId, followingId);
  res.json({ success: true });
});

socialRouter.post('/unfollow/:userId', async (req: AuthRequest, res) => {
  const followerId = req.user!.userId;
  const followingId = req.params.userId;
  await SocialService.unfollowUser(followerId, followingId);
  res.json({ success: true });
});

// Block / Unblock
socialRouter.post('/block/:userId', async (req: AuthRequest, res) => {
  const blockerId = req.user!.userId;
  const blockedId = req.params.userId;
  await SocialService.blockUser(blockerId, blockedId);
  res.json({ success: true });
});

socialRouter.post('/unblock/:userId', async (req: AuthRequest, res) => {
  const blockerId = req.user!.userId;
  const blockedId = req.params.userId;
  await SocialService.unblockUser(blockerId, blockedId);
  res.json({ success: true });
});

// Get lists
socialRouter.get('/followers/:userId', async (req: AuthRequest, res) => {
  const followers = await SocialService.getFollowers(req.params.userId);
  res.json(followers);
});

socialRouter.get('/following/:userId', async (req: AuthRequest, res) => {
  const following = await SocialService.getFollowing(req.params.userId);
  res.json(following);
});

// Check relationship status for current user vs target
socialRouter.get('/status/:userId', async (req: AuthRequest, res) => {
  const status = await SocialService.getRelationshipStatus(req.user!.userId, req.params.userId);
  res.json(status);
});
