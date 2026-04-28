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
    const participant = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId: senderId } },
    });
    if (!participant) throw new Error('NOT_A_PARTICIPANT');

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
   * Soft-deletes a message. Only the original sender can delete it.
   */
  static async delete(conversationId: string, messageId: string, requestingUserId: string) {
    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.deletedAt || message.conversationId !== conversationId) {
      throw new Error('MESSAGE_NOT_FOUND');
    }
    if (message.senderId !== requestingUserId) throw new Error('FORBIDDEN');

    return prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
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
