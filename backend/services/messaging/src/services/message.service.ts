import { prisma } from '@common/db/prisma';

export class MessageService {
  /**
   * Sends a message to a conversation.
   * Verifies the sender is a participant before allowing it.
   */
  static async send(conversationId: string, senderId: string, content: string) {
    const trimmed = content?.trim();
    if (!trimmed) throw new Error('MESSAGE_EMPTY');
    if (trimmed.length > 4000) throw new Error('MESSAGE_TOO_LONG');

    // Authorization: sender must be a participant
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: {
          select: { userId: true },
        },
      },
    });

    if (!conversation) throw new Error('CONVERSATION_NOT_FOUND');

    const isParticipant = conversation.participants.some((p) => p.userId === senderId);
    if (!isParticipant) throw new Error('NOT_A_PARTICIPANT');

    // If direct conversation, check for blocks
    if (conversation.type === 'direct') {
      const otherParticipant = conversation.participants.find((p) => p.userId !== senderId);
      if (otherParticipant) {
        const block = await prisma.block.findFirst({
          where: {
            OR: [
              { blockerId: senderId, blockedId: otherParticipant.userId },
              { blockerId: otherParticipant.userId, blockedId: senderId },
            ],
          },
        });
        if (block) throw new Error('FORBIDDEN');
      }
    }

    // Create message and bump the conversation's updatedAt atomically
    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: { conversationId, senderId, content: trimmed },
        include: {
          sender: {
            select: { id: true, username: true, displayName: true, avatarUrl: true },
          },
        },
      }),
      prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      }),
    ]);

    return message;
  }

  /**
   * Lists messages in a conversation with cursor-based pagination.
   * Most recent messages first.
   */
  static async list(conversationId: string, requestingUserId: string, cursor?: string, limit = 50) {
    // Authorization check
    const participant = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId: requestingUserId } },
    });
    if (!participant) throw new Error('NOT_A_PARTICIPANT');

    const messages = await prisma.message.findMany({
      where: {
        conversationId,
        deletedAt: null,
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
      },
      include: {
        sender: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return {
      messages,
      nextCursor:
        messages.length > 0 && messages.length === limit
          ? messages[messages.length - 1].createdAt.toISOString()
          : null,
    };
  }

  /**
   * Soft-deletes a message. Only the original sender or a group admin can delete it.
   */
  static async delete(conversationId: string, messageId: string, requestingUserId: string) {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        conversation: {
          include: {
            participants: {
              where: { userId: requestingUserId },
            },
          },
        },
      },
    });

    if (!message || message.deletedAt || message.conversationId !== conversationId) {
      throw new Error('MESSAGE_NOT_FOUND');
    }

    const requestingPart = message.conversation.participants[0];
    const isSender = message.senderId === requestingUserId;
    const isAdmin = requestingPart?.role === 'admin';

    if (!isSender && !isAdmin) throw new Error('FORBIDDEN');

    return prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Edits a message's content. Only the original sender can edit it.
   */
  static async edit(
    conversationId: string,
    messageId: string,
    requestingUserId: string,
    newContent: string,
  ) {
    const trimmed = newContent?.trim();
    if (!trimmed) throw new Error('MESSAGE_EMPTY');
    if (trimmed.length > 4000) throw new Error('MESSAGE_TOO_LONG');

    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.deletedAt || message.conversationId !== conversationId) {
      throw new Error('MESSAGE_NOT_FOUND');
    }
    if (message.senderId !== requestingUserId) throw new Error('FORBIDDEN');

    return prisma.message.update({
      where: { id: messageId },
      data: { content: trimmed, updatedAt: new Date() },
    });
  }

  /**
   * Marks the conversation as read up to "now" for the requesting user.
   */
  static async markRead(conversationId: string, userId: string) {
    const participant = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!participant) throw new Error('NOT_A_PARTICIPANT');

    return prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt: new Date() },
    });
  }
}
