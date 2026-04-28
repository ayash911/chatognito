import { prisma } from '@common/db/prisma';

export class ConversationService {
  /**
   * Creates a direct (1-on-1) conversation between two users.
   * If one already exists, returns the existing one instead of creating a duplicate.
   */
  static async getOrCreateDirect(userAId: string, userBId: string) {
    if (userAId === userBId) {
      throw new Error('CANNOT_MESSAGE_SELF');
    }

    // Check if users actually exist and are not deleted
    const users = await prisma.user.findMany({
      where: { id: { in: [userAId, userBId] }, deletedAt: null },
      select: { id: true },
    });
    if (users.length !== 2) {
      throw new Error('USER_NOT_FOUND');
    }

    // Find an existing direct conversation shared by both users
    const existing = await prisma.conversation.findFirst({
      where: {
        type: 'direct',
        participants: {
          every: { userId: { in: [userAId, userBId] } },
        },
        AND: [
          { participants: { some: { userId: userAId } } },
          { participants: { some: { userId: userBId } } },
        ],
      },
      include: { participants: true },
    });

    if (existing) return existing;

    return prisma.conversation.create({
      data: {
        type: 'direct',
        participants: {
          createMany: {
            data: [{ userId: userAId }, { userId: userBId }],
          },
        },
      },
      include: { participants: true },
    });
  }

  /**
   * Creates a group conversation with a title and a list of member IDs.
   */
  static async createGroup(creatorId: string, title: string, memberIds: string[]) {
    if (!title || title.trim().length === 0) {
      throw new Error('INVALID_GROUP_TITLE');
    }

    // Deduplicate and include the creator
    const allMemberIds = [...new Set([creatorId, ...memberIds])];

    if (allMemberIds.length < 2) {
      throw new Error('GROUP_NEEDS_MORE_MEMBERS');
    }

    // Validate all members exist
    const users = await prisma.user.findMany({
      where: { id: { in: allMemberIds }, deletedAt: null },
      select: { id: true },
    });
    if (users.length !== allMemberIds.length) {
      throw new Error('USER_NOT_FOUND');
    }

    return prisma.conversation.create({
      data: {
        type: 'group',
        title: title.trim(),
        participants: {
          createMany: {
            data: allMemberIds.map((userId) => ({
              userId,
              role: userId === creatorId ? 'admin' : 'member',
            })),
          },
        },
      },
      include: { participants: true },
    });
  }

  /**
   * Lists all conversations for a given user, ordered by most recently updated.
   */
  static async listForUser(userId: string) {
    return prisma.conversation.findMany({
      where: {
        participants: { some: { userId } },
      },
      include: {
        participants: {
          select: {
            userId: true,
            role: true,
            lastReadAt: true,
            user: {
              select: { id: true, username: true, displayName: true, avatarUrl: true },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1, // Last message preview
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Gets a single conversation by ID, ensuring the requesting user is a participant.
   */
  static async getOne(conversationId: string, requestingUserId: string) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: true },
    });

    if (!conversation) throw new Error('CONVERSATION_NOT_FOUND');

    const isMember = conversation.participants.some((p) => p.userId === requestingUserId);
    if (!isMember) throw new Error('NOT_A_PARTICIPANT');

    return conversation;
  }

  /**
   * Updates the title of a group conversation.
   * Only admins can change the title.
   */
  static async updateGroupTitle(
    conversationId: string,
    requestingUserId: string,
    newTitle: string,
  ) {
    if (!newTitle || newTitle.trim().length === 0) {
      throw new Error('INVALID_GROUP_TITLE');
    }

    const participant = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId: requestingUserId } },
    });

    if (!participant) throw new Error('NOT_A_PARTICIPANT');
    if (participant.role !== 'admin') throw new Error('FORBIDDEN');

    return prisma.conversation.update({
      where: { id: conversationId },
      data: { title: newTitle.trim() },
    });
  }

  /**
   * Adds a user to a group conversation.
   */
  static async addParticipant(
    conversationId: string,
    requestingUserId: string,
    targetUserId: string,
  ) {
    const convo = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: true },
    });

    if (!convo) throw new Error('CONVERSATION_NOT_FOUND');
    if (convo.type !== 'group') throw new Error('NOT_A_GROUP');

    const requestingPart = convo.participants.find((p) => p.userId === requestingUserId);
    if (!requestingPart) throw new Error('NOT_A_PARTICIPANT');
    if (requestingPart.role !== 'admin') throw new Error('FORBIDDEN');

    const alreadyMember = convo.participants.some((p) => p.userId === targetUserId);
    if (alreadyMember) throw new Error('ALREADY_A_MEMBER');

    return prisma.conversationParticipant.create({
      data: { conversationId, userId: targetUserId, role: 'member' },
    });
  }

  /**
   * Removes a user from a group conversation.
   */
  static async removeParticipant(
    conversationId: string,
    requestingUserId: string,
    targetUserId: string,
  ) {
    const convo = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: true },
    });

    if (!convo) throw new Error('CONVERSATION_NOT_FOUND');
    if (convo.type !== 'group') throw new Error('NOT_A_GROUP');

    const requestingPart = convo.participants.find((p) => p.userId === requestingUserId);
    if (!requestingPart) throw new Error('NOT_A_PARTICIPANT');

    // Admins can remove anyone, members can only remove themselves (leave)
    const isRemovingSelf = requestingUserId === targetUserId;
    if (requestingPart.role !== 'admin' && !isRemovingSelf) {
      throw new Error('FORBIDDEN');
    }

    // Ensure we don't leave a group with zero participants
    if (convo.participants.length <= 1) {
      // In a real app, we might delete the conversation here
      throw new Error('CANNOT_REMOVE_LAST_PARTICIPANT');
    }

    return prisma.conversationParticipant.delete({
      where: { conversationId_userId: { conversationId, userId: targetUserId } },
    });
  }

  /**
   * Updates a participant's role (admin/member).
   */
  static async setParticipantRole(
    conversationId: string,
    requestingUserId: string,
    targetUserId: string,
    newRole: 'admin' | 'member',
  ) {
    const convo = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: true },
    });

    if (!convo) throw new Error('CONVERSATION_NOT_FOUND');
    if (convo.type !== 'group') throw new Error('NOT_A_GROUP');

    const requestingPart = convo.participants.find((p) => p.userId === requestingUserId);
    if (!requestingPart || requestingPart.role !== 'admin') {
      throw new Error('FORBIDDEN');
    }

    const targetPart = convo.participants.find((p) => p.userId === targetUserId);
    if (!targetPart) throw new Error('NOT_A_PARTICIPANT');

    // Prevent demoting the last admin
    if (newRole === 'member' && targetPart.role === 'admin') {
      const adminCount = convo.participants.filter((p) => p.role === 'admin').length;
      if (adminCount <= 1) {
        throw new Error('CANNOT_DEMOTE_LAST_ADMIN');
      }
    }

    return prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId: targetUserId } },
      data: { role: newRole },
    });
  }
}
