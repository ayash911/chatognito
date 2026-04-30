import { Router } from 'express';
import { requireAuth, AuthRequest } from '@auth/middlewares/auth.middleware';
import { SocialService } from '@social/services/social.service';

export const socialRouter = Router();

// All social routes require authentication
socialRouter.use(requireAuth);

// Follow / Unfollow
socialRouter.put('/:userId/follow', async (req: AuthRequest, res) => {
  const followerId = req.user!.userId;
  const followingId = req.params.userId;
  await SocialService.followUser(followerId, followingId);
  res.json({ success: true });
});

socialRouter.delete('/:userId/follow', async (req: AuthRequest, res) => {
  const followerId = req.user!.userId;
  const followingId = req.params.userId;
  await SocialService.unfollowUser(followerId, followingId);
  res.json({ success: true });
});

// Block / Unblock
socialRouter.put('/:userId/block', async (req: AuthRequest, res) => {
  const blockerId = req.user!.userId;
  const blockedId = req.params.userId;
  await SocialService.blockUser(blockerId, blockedId);
  res.json({ success: true });
});

socialRouter.delete('/:userId/block', async (req: AuthRequest, res) => {
  const blockerId = req.user!.userId;
  const blockedId = req.params.userId;
  await SocialService.unblockUser(blockerId, blockedId);
  res.json({ success: true });
});

// Get lists
socialRouter.get('/:userId/followers', async (req: AuthRequest, res) => {
  const followers = await SocialService.getFollowers(req.params.userId);
  res.json(followers);
});

socialRouter.get('/:userId/following', async (req: AuthRequest, res) => {
  const following = await SocialService.getFollowing(req.params.userId);
  res.json(following);
});

// Check relationship status for current user vs target
socialRouter.get('/:userId/status', async (req: AuthRequest, res) => {
  const status = await SocialService.getRelationshipStatus(req.user!.userId, req.params.userId);
  res.json(status);
});
