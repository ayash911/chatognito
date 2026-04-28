/* eslint-disable @typescript-eslint/no-explicit-any */
import { MessageService } from '@messaging/services/message.service';
import { prisma } from '@common/db/prisma';

jest.mock('@common/db/prisma', () => ({
  prisma: {
    conversationParticipant: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    conversation: {
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    block: {
      findFirst: jest.fn(),
    },
    message: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

const mockParticipant = (exists: boolean, type: string = 'direct', isMember: boolean = true) => {
  (prisma.conversation.findUnique as jest.Mock).mockResolvedValue(
    exists
      ? {
          id: 'c1',
          type,
          participants: isMember ? [{ userId: 'u1' }, { userId: 'u2' }] : [{ userId: 'u2' }],
        }
      : null,
  );
  (prisma.conversationParticipant.findUnique as jest.Mock).mockResolvedValue(
    exists && isMember ? { userId: 'u1', conversationId: 'c1' } : null,
  );
};

describe('MessageService Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ((prisma as any).block.findFirst as jest.Mock).mockResolvedValue(null);
    mockParticipant(true); // Default to existing and being a member
  });

  describe('send', () => {
    it('should throw MESSAGE_EMPTY for blank content', async () => {
      await expect(MessageService.send('c1', 'u1', '   ')).rejects.toThrow('MESSAGE_EMPTY');
    });

    it('should throw MESSAGE_TOO_LONG for content over 4000 chars', async () => {
      await expect(MessageService.send('c1', 'u1', 'a'.repeat(4001))).rejects.toThrow(
        'MESSAGE_TOO_LONG',
      );
    });

    it('should throw NOT_A_PARTICIPANT if the sender is not in the conversation', async () => {
      mockParticipant(true, 'direct', false);
      await expect(MessageService.send('c1', 'u1', 'Hello')).rejects.toThrow('NOT_A_PARTICIPANT');
    });

    it('should create a message and bump conversation updatedAt in a transaction', async () => {
      mockParticipant(true);
      const createdMsg = { id: 'm1', content: 'Hello', senderId: 'u1' };
      ((prisma as any).$transaction as jest.Mock).mockResolvedValue([createdMsg, {}]);

      const result = await MessageService.send('c1', 'u1', 'Hello');
      expect(result).toEqual(createdMsg);
      expect((prisma as any).$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('list', () => {
    it('should throw NOT_A_PARTICIPANT for non-members', async () => {
      mockParticipant(false);
      await expect(MessageService.list('c1', 'u1')).rejects.toThrow('NOT_A_PARTICIPANT');
    });

    it('should return messages and a nextCursor when more pages exist', async () => {
      mockParticipant(true);
      const messages = Array.from({ length: 50 }, (_, i) => ({
        id: `m${i}`,
        createdAt: new Date(Date.now() - i * 1000),
      }));
      ((prisma as any).message.findMany as jest.Mock).mockResolvedValue(messages);

      const result = await MessageService.list('c1', 'u1', undefined, 50);
      expect(result.messages.length).toBe(50);
      expect(result.nextCursor).toBeDefined();
    });

    it('should return null nextCursor when fewer than limit messages are returned', async () => {
      mockParticipant(true);
      ((prisma as any).message.findMany as jest.Mock).mockResolvedValue([
        { id: 'm1', createdAt: new Date() },
      ]);

      const result = await MessageService.list('c1', 'u1', undefined, 50);
      expect(result.nextCursor).toBeNull();
    });
  });

  describe('delete', () => {
    it('should throw MESSAGE_NOT_FOUND for a non-existent message', async () => {
      ((prisma as any).message.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(MessageService.delete('c1', 'm1', 'u1')).rejects.toThrow('MESSAGE_NOT_FOUND');
    });

    it('should throw MESSAGE_NOT_FOUND if the message is already deleted', async () => {
      ((prisma as any).message.findUnique as jest.Mock).mockResolvedValue({
        id: 'm1',
        senderId: 'u1',
        conversationId: 'c1',
        deletedAt: new Date(),
      });
      await expect(MessageService.delete('c1', 'm1', 'u1')).rejects.toThrow('MESSAGE_NOT_FOUND');
    });

    it('should throw MESSAGE_NOT_FOUND if conversationId mismatch', async () => {
      ((prisma as any).message.findUnique as jest.Mock).mockResolvedValue({
        id: 'm1',
        senderId: 'u1',
        conversationId: 'wrong_c',
      });
      await expect(MessageService.delete('c1', 'm1', 'u1')).rejects.toThrow('MESSAGE_NOT_FOUND');
    });

    it('should throw FORBIDDEN if a different user tries to delete the message', async () => {
      ((prisma as any).message.findUnique as jest.Mock).mockResolvedValue({
        id: 'm1',
        senderId: 'u2',
        conversationId: 'c1',
        deletedAt: null,
      });
      await expect(MessageService.delete('c1', 'm1', 'u1')).rejects.toThrow('FORBIDDEN');
    });

    it('should update deletedAt if all checks pass', async () => {
      ((prisma as any).message.findUnique as jest.Mock).mockResolvedValue({
        id: 'm1',
        senderId: 'u1',
        conversationId: 'c1',
        deletedAt: null,
      });
      ((prisma as any).message.update as jest.Mock).mockResolvedValue({ id: 'm1' });
      const result = await MessageService.delete('c1', 'm1', 'u1');
      expect(result.id).toBe('m1');
    });
  });

  describe('markRead', () => {
    it('should throw NOT_A_PARTICIPANT for non-members', async () => {
      mockParticipant(false);
      await expect(MessageService.markRead('c1', 'u1')).rejects.toThrow('NOT_A_PARTICIPANT');
    });

    it('should update lastReadAt on success', async () => {
      mockParticipant(true);
      ((prisma as any).conversationParticipant.update as jest.Mock).mockResolvedValue({
        lastReadAt: new Date(),
      });
      const result = await MessageService.markRead('c1', 'u1');
      expect(result.lastReadAt).toBeDefined();
    });
  });
});
