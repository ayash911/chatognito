import { prisma } from '@common/db/prisma';

export class ConversationSocketService {
  static async listConversationIds(userId: string): Promise<string[]> {
    const participants = await prisma.conversationParticipant.findMany({
      where: { userId },
      select: { conversationId: true },
    });

    return participants.map((participant) => participant.conversationId);
  }

  static async assertParticipant(conversationId: string, userId: string) {
    const participant = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { conversationId: true },
    });

    if (!participant) throw new Error('NOT_A_PARTICIPANT');
  }

  static async listPresenceAudience(userId: string): Promise<string[]> {
    const conversations = await prisma.conversation.findMany({
      where: {
        participants: { some: { userId } },
      },
      select: {
        participants: {
          select: { userId: true },
        },
      },
    });

    const audience = new Set<string>();
    for (const conversation of conversations) {
      for (const participant of conversation.participants) {
        if (participant.userId !== userId) {
          audience.add(participant.userId);
        }
      }
    }

    return [...audience];
  }
}
