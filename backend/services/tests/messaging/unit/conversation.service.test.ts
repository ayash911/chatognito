/* eslint-disable @typescript-eslint/no-explicit-any */
import { ConversationService } from '@messaging/services/conversation.service';
import { prisma } from '@common/db/prisma';

jest.mock('@common/db/prisma', () => ({
  prisma: {
    user: { findMany: jest.fn() },
    conversation: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    conversationParticipant: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
    block: {
      findFirst: jest.fn(),
    },
    message: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((val) => val),
  },
}));

const mockUsers = (ids: string[]) => {
  return ((prisma as any).user.findMany as jest.Mock).mockResolvedValue(ids.map((id) => ({ id })));
};

describe('ConversationService Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ((prisma as any).block.findFirst as jest.Mock).mockResolvedValue(null);
  });

  describe('getOrCreateDirect', () => {
    it('should throw CANNOT_MESSAGE_SELF when both user IDs are identical', async () => {
      await expect(ConversationService.getOrCreateDirect('u1', 'u1')).rejects.toThrow(
        'CANNOT_MESSAGE_SELF',
      );
    });

    it('should throw USER_NOT_FOUND when one of the users does not exist', async () => {
      mockUsers(['u1']); // only one user returned
      await expect(ConversationService.getOrCreateDirect('u1', 'u2')).rejects.toThrow(
        'USER_NOT_FOUND',
      );
    });

    it('should return an existing conversation if one already exists', async () => {
      mockUsers(['u1', 'u2']);
      const existingConvo = { id: 'convo-1', type: 'direct', participants: [] };
      (prisma.conversation.findFirst as jest.Mock).mockResolvedValue(existingConvo);

      const result = await ConversationService.getOrCreateDirect('u1', 'u2');
      expect(result).toEqual(existingConvo);
      expect((prisma as any).conversation.create).not.toHaveBeenCalled();
    });

    it('should create a new conversation when none exists', async () => {
      mockUsers(['u1', 'u2']);
      (prisma.conversation.findFirst as jest.Mock).mockResolvedValue(null);
      const newConvo = { id: 'convo-2', type: 'direct', participants: [] };
      (prisma.conversation.create as jest.Mock).mockResolvedValue(newConvo);

      const result = await ConversationService.getOrCreateDirect('u1', 'u2');
      expect(result).toEqual(newConvo);
      expect((prisma as any).conversation.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('createGroup', () => {
    it('should throw INVALID_GROUP_TITLE for an empty title', async () => {
      await expect(ConversationService.createGroup('u1', '  ', ['u2'])).rejects.toThrow(
        'INVALID_GROUP_TITLE',
      );
    });

    it('should throw GROUP_NEEDS_MORE_MEMBERS if only the creator is provided', async () => {
      await expect(ConversationService.createGroup('u1', 'My Group', [])).rejects.toThrow(
        'GROUP_NEEDS_MORE_MEMBERS',
      );
    });

    it('should throw USER_NOT_FOUND if a member does not exist', async () => {
      mockUsers(['u1']); // u2 is missing
      await expect(ConversationService.createGroup('u1', 'My Group', ['u2'])).rejects.toThrow(
        'USER_NOT_FOUND',
      );
    });

    it('should create a group and make the creator an admin', async () => {
      mockUsers(['u1', 'u2', 'u3']);
      const newGroup = { id: 'group-1', type: 'group', title: 'My Group', participants: [] };
      (prisma.conversation.create as jest.Mock).mockResolvedValue(newGroup);

      const result = await ConversationService.createGroup('u1', 'My Group', ['u2', 'u3']);
      expect(result).toEqual(newGroup);
      const createCall = ((prisma as any).conversation.create as jest.Mock).mock.calls[0][0];
      const adminEntry = createCall.data.participants.createMany.data.find(
        (p: { userId: string; role: string }) => p.userId === 'u1',
      );
      expect(adminEntry.role).toBe('admin');
    });

    it('should deduplicate members even if creator is listed twice', async () => {
      mockUsers(['u1', 'u2']);
      (prisma as any).conversation.create.mockResolvedValue({});
      await ConversationService.createGroup('u1', 'Test', ['u1', 'u2']);
      const createCall = ((prisma as any).conversation.create as jest.Mock).mock.calls[0][0];
      const members = createCall.data.participants.createMany.data;
      expect(members.length).toBe(2); // creator + u2, no duplicate
    });
  });

  describe('getOne', () => {
    it('should throw CONVERSATION_NOT_FOUND for a non-existent id', async () => {
      ((prisma as any).conversation.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(ConversationService.getOne('bad-id', 'u1')).rejects.toThrow(
        'CONVERSATION_NOT_FOUND',
      );
    });

    it('should throw NOT_A_PARTICIPANT if the user is not in the conversation', async () => {
      ((prisma as any).conversation.findUnique as jest.Mock).mockResolvedValue({
        id: 'c1',
        participants: [{ userId: 'u2' }],
      });
      await expect(ConversationService.getOne('c1', 'u1')).rejects.toThrow('NOT_A_PARTICIPANT');
    });

    it('should return the conversation if the user is a participant', async () => {
      const convo = { id: 'c1', participants: [{ userId: 'u1' }] };
      ((prisma as any).conversation.findUnique as jest.Mock).mockResolvedValue(convo);
      const result = await ConversationService.getOne('c1', 'u1');
      expect(result).toEqual(convo);
    });
  });

  describe('listForUser', () => {
    it('should return an empty list if user has no conversations', async () => {
      ((prisma as any).conversation.findMany as jest.Mock).mockResolvedValue([]);
      const result = await ConversationService.listForUser('u1');
      expect(result).toEqual([]);
    });

    it('should return a list of conversations for the user', async () => {
      const convos = [{ id: 'c1', participants: [] }];
      ((prisma as any).conversation.findMany as jest.Mock).mockResolvedValue(convos);
      const result = await ConversationService.listForUser('u1');
      expect(result).toEqual(convos);
    });
  });

  describe('updateGroupTitle', () => {
    it('should throw FORBIDDEN if user is not an admin', async () => {
      ((prisma as any).conversationParticipant.findUnique as jest.Mock).mockResolvedValue({
        role: 'member',
      });
      await expect(ConversationService.updateGroupTitle('c1', 'u1', 'New Title')).rejects.toThrow(
        'FORBIDDEN',
      );
    });

    it('should update title if user is admin', async () => {
      ((prisma as any).conversationParticipant.findUnique as jest.Mock).mockResolvedValue({
        role: 'admin',
      });
      ((prisma as any).conversation.update as jest.Mock).mockResolvedValue({
        id: 'c1',
        title: 'New Title',
      });
      const result = await ConversationService.updateGroupTitle('c1', 'u1', 'New Title');
      expect(result.title).toBe('New Title');
    });
  });

  describe('addParticipant', () => {
    it('should throw NOT_A_GROUP for direct chats', async () => {
      ((prisma as any).conversation.findUnique as jest.Mock).mockResolvedValue({
        type: 'direct',
        participants: [{ userId: 'u1', role: 'admin' }],
      });
      await expect(ConversationService.addParticipant('c1', 'u1', 'u2')).rejects.toThrow(
        'NOT_A_GROUP',
      );
    });

    it('should add participant if requester is admin', async () => {
      ((prisma as any).conversation.findUnique as jest.Mock).mockResolvedValue({
        type: 'group',
        participants: [{ userId: 'u1', role: 'admin' }],
      });
      ((prisma as any).conversationParticipant.create as jest.Mock).mockResolvedValue({
        userId: 'u2',
      });
      const result = await ConversationService.addParticipant('c1', 'u1', 'u2');
      expect(result.userId).toBe('u2');
    });
  });
});
