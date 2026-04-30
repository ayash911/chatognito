import { Router, Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '@auth/middlewares/auth.middleware';
import { ConversationService } from '../services/conversation.service';
import { MessageService } from '../services/message.service';

export const conversationRouter = Router();

// All messaging routes require authentication
conversationRouter.use(requireAuth);

// List all conversations for the current user
conversationRouter.get('/', async (req: AuthRequest, res: Response) => {
  const conversations = await ConversationService.listForUser(req.user!.userId);
  res.json(conversations);
});

// Start or get a direct conversation with another user
conversationRouter.post('/direct', async (req: AuthRequest, res: Response) => {
  const { targetUserId } = z.object({ targetUserId: z.string().uuid() }).parse(req.body);

  const conversation = await ConversationService.getOrCreateDirect(req.user!.userId, targetUserId);
  res.status(200).json(conversation);
});

// Create a group conversation
conversationRouter.post('/group', async (req: AuthRequest, res: Response) => {
  const { title, memberIds } = z
    .object({
      title: z.string().min(1).max(100),
      memberIds: z.array(z.string().uuid()).min(1),
    })
    .parse(req.body);

  const conversation = await ConversationService.createGroup(req.user!.userId, title, memberIds);
  res.status(201).json(conversation);
});

// Get a single conversation by ID
conversationRouter.get('/:conversationId', async (req: AuthRequest, res: Response) => {
  const conversation = await ConversationService.getOne(
    req.params.conversationId,
    req.user!.userId,
  );
  res.json(conversation);
});

// List messages in a conversation (paginated)
conversationRouter.get('/:conversationId/messages', async (req: AuthRequest, res: Response) => {
  const cursor = req.query.cursor as string | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

  const result = await MessageService.list(
    req.params.conversationId,
    req.user!.userId,
    cursor,
    limit,
  );
  res.json(result);
});

// Send a message to a conversation
conversationRouter.post('/:conversationId/messages', async (req: AuthRequest, res: Response) => {
  const { content, isEncrypted, encryptionHeader } = z
    .object({
      content: z.string().min(1),
      isEncrypted: z.boolean().optional(),
      encryptionHeader: z.string().optional(),
    })
    .parse(req.body);
  const message = await MessageService.send(
    req.params.conversationId,
    req.user!.userId,
    content,
    isEncrypted,
    encryptionHeader,
  );
  res.status(201).json(message);
});

// Soft-delete a message
conversationRouter.delete(
  '/:conversationId/messages/:messageId',
  async (req: AuthRequest, res: Response) => {
    await MessageService.delete(
      req.params.conversationId,
      req.params.messageId,
      req.user!.userId,
      req.user!.role,
    );
    res.json({ success: true });
  },
);

// Edit a message
conversationRouter.patch(
  '/:conversationId/messages/:messageId',
  async (req: AuthRequest, res: Response) => {
    const { content } = z.object({ content: z.string().min(1) }).parse(req.body);
    const message = await MessageService.edit(
      req.params.conversationId,
      req.params.messageId,
      req.user!.userId,
      content,
      req.user!.role,
    );
    res.json(message);
  },
);

// Mark conversation as read
conversationRouter.put('/:conversationId/read', async (req: AuthRequest, res: Response) => {
  await MessageService.markRead(req.params.conversationId, req.user!.userId);
  res.json({ success: true });
});

// Update group title
conversationRouter.patch('/:conversationId/title', async (req: AuthRequest, res: Response) => {
  const { title } = z.object({ title: z.string().min(1).max(100) }).parse(req.body);
  await ConversationService.updateGroupTitle(req.params.conversationId, req.user!.userId, title);
  res.json({ success: true });
});

// Add participant to group
conversationRouter.post(
  '/:conversationId/participants',
  async (req: AuthRequest, res: Response) => {
    const { targetUserId } = z.object({ targetUserId: z.string().uuid() }).parse(req.body);
    await ConversationService.addParticipant(
      req.params.conversationId,
      req.user!.userId,
      targetUserId,
    );
    res.json({ success: true });
  },
);

// Remove participant from group (or leave)
conversationRouter.delete(
  '/:conversationId/participants/:targetUserId',
  async (req: AuthRequest, res: Response) => {
    await ConversationService.removeParticipant(
      req.params.conversationId,
      req.user!.userId,
      req.params.targetUserId,
    );
    res.json({ success: true });
  },
);

// Update participant role
conversationRouter.put(
  '/:conversationId/participants/:targetUserId/role',
  async (req: AuthRequest, res: Response) => {
    const { role } = z.object({ role: z.enum(['admin', 'member']) }).parse(req.body);
    await ConversationService.setParticipantRole(
      req.params.conversationId,
      req.user!.userId,
      req.params.targetUserId,
      role,
    );
    res.json({ success: true });
  },
);
