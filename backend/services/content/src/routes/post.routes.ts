import { Router } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { requireAuth, AuthRequest } from '@auth/middlewares/auth.middleware';
import { PostService } from '../services/post.service';

export const contentRouter = Router();

const createPostSchema = z.object({
  content: z.string().min(1).max(10000),
  visibility: z.enum(['public', 'followers', 'private']).optional(),
  media: z
    .array(
      z.object({
        type: z.enum(['image', 'video']),
        url: z.string().url(),
        metadata: z.record(z.any()).optional(),
      }),
    )
    .optional(),
});

// Post creation and management
contentRouter.post('/posts', requireAuth, async (req: AuthRequest, res) => {
  const data = createPostSchema.parse(req.body);
  const post = await PostService.createPost(req.user!.userId, data);
  res.status(201).json(post);
});

contentRouter.get('/posts/:id', async (req, res) => {
  // Extract user if token is present, but don't require it
  const authHeader = req.headers.authorization;
  let viewerId: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as jwt.JwtPayload;
      viewerId = decoded.userId;
    } catch (_err) {
      // Ignore invalid token, treat as guest
    }
  }

  const post = await PostService.getPost(req.params.id, viewerId);
  res.json(post);
});

contentRouter.delete('/posts/:id', requireAuth, async (req: AuthRequest, res) => {
  await PostService.deletePost(req.user!.userId, req.params.id);
  res.json({ success: true });
});

// Likes
contentRouter.put('/posts/:id/like', requireAuth, async (req: AuthRequest, res) => {
  await PostService.likePost(req.user!.userId, req.params.id);
  res.json({ success: true });
});

contentRouter.delete('/posts/:id/like', requireAuth, async (req: AuthRequest, res) => {
  await PostService.unlikePost(req.user!.userId, req.params.id);
  res.json({ success: true });
});

// Comments
contentRouter.post('/posts/:id/comments', requireAuth, async (req: AuthRequest, res) => {
  const { content, parentId } = z
    .object({
      content: z.string().min(1).max(2000),
      parentId: z.string().uuid().optional(),
    })
    .parse(req.body);

  const comment = await PostService.addComment(req.user!.userId, req.params.id, content, parentId);
  res.status(201).json(comment);
});

contentRouter.get('/posts/:id/comments', async (req, res) => {
  // Extract user if token is present
  const authHeader = req.headers.authorization;
  let viewerId: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as jwt.JwtPayload;
      viewerId = decoded.userId;
    } catch (_err) {
      // Ignore invalid token
    }
  }

  const comments = await PostService.listComments(req.params.id, viewerId);
  res.json(comments);
});

contentRouter.delete(
  '/posts/:postId/comments/:commentId',
  requireAuth,
  async (req: AuthRequest, res) => {
    await PostService.deleteComment(req.user!.userId, req.params.commentId);
    res.json({ success: true });
  },
);

// Feed and Discovery
contentRouter.get('/feed', requireAuth, async (req: AuthRequest, res) => {
  const { limit, cursor } = z
    .object({
      limit: z.string().transform(Number).optional(),
      cursor: z.string().uuid().optional(),
    })
    .parse(req.query);

  const feed = await PostService.getFeed(req.user!.userId, limit, cursor);
  res.json(feed);
});
