import { prisma } from '@common/db/prisma';
import { logger } from '@chatognito/logger';
import { E2EEService } from './e2ee.service';

export class MessageService {
  /**
   * Sends a message to a conversation.
   * Verifies the sender is a participant before allowing it.
   */
  static async send(
    conversationId: string,
    senderId: string,
    content: string,
    isEncrypted: boolean = false,
    encryptionHeader: string | null = null,
  ) {
    logger.info({ conversationId, senderId, isEncrypted }, 'Attempting to send message');
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
        data: { conversationId, senderId, content: trimmed, isEncrypted, encryptionHeader },
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

    logger.info({ messageId: message.id, conversationId }, 'Message sent successfully');
    return message;
  }

  /**
   * Sends an encrypted one-on-one message from the realtime gateway.
   * The server stores only ciphertext plus Double Ratchet metadata.
   */
  static async sendEncryptedDirect(
    conversationId: string,
    senderId: string,
    ciphertext: string,
    encryptionHeader: string,
  ) {
    E2EEService.assertEncryptedDirectMessage(ciphertext, encryptionHeader);

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { type: true },
    });

    if (!conversation) throw new Error('CONVERSATION_NOT_FOUND');
    if (conversation.type !== 'direct') throw new Error('ENCRYPTED_DM_ONLY');

    return this.send(
      conversationId,
      senderId,
      ciphertext,
      true,
      E2EEService.serializeEnvelope(encryptionHeader),
    );
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
  static async delete(
    conversationId: string,
    messageId: string,
    requestingUserId: string,
    requestingUserRole: string = 'user',
  ) {
    logger.info({ conversationId, messageId, requestingUserId }, 'Attempting to delete message');
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

    const isGlobalModerator = requestingUserRole === 'admin' || requestingUserRole === 'moderator';

    if (!isSender && !isAdmin && !isGlobalModerator) throw new Error('FORBIDDEN');

    const deleted = await prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    });
    logger.info({ messageId, conversationId }, 'Message soft-deleted successfully');
    return deleted;
  }

  /**
   * Edits a message's content. Only the original sender can edit it.
   */
  static async edit(
    conversationId: string,
    messageId: string,
    requestingUserId: string,
    newContent: string,
    requestingUserRole: string = 'user',
  ) {
    logger.info({ conversationId, messageId, requestingUserId }, 'Attempting to edit message');
    const trimmed = newContent?.trim();
    if (!trimmed) throw new Error('MESSAGE_EMPTY');
    if (trimmed.length > 4000) throw new Error('MESSAGE_TOO_LONG');

    const message = await prisma.message.findUnique({ where: { id: messageId } });
    if (!message || message.deletedAt || message.conversationId !== conversationId) {
      throw new Error('MESSAGE_NOT_FOUND');
    }
    const isGlobalModerator = requestingUserRole === 'admin' || requestingUserRole === 'moderator';
    if (message.senderId !== requestingUserId && !isGlobalModerator) throw new Error('FORBIDDEN');

    const edited = await prisma.message.update({
      where: { id: messageId },
      data: { content: trimmed, updatedAt: new Date() },
    });
    logger.info({ messageId, conversationId }, 'Message edited successfully');
    return edited;
  }

  /**
   * Marks the conversation as read up to "now" for the requesting user.
   */
  static async markRead(conversationId: string, userId: string) {
    logger.info({ conversationId, userId }, 'Marking conversation as read');
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
