import type { PresenceStatus } from '../types';

export interface PresenceRedisStore {
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  scard(key: string): Promise<number>;
  smembers(key: string): Promise<string[]>;
  set(key: string, value: string): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
}

export interface PresencePrismaClient {
  user: {
    update(args: { where: { id: string }; data: { lastSeenAt: Date } }): Promise<unknown>;
    findUnique(args: {
      where: { id: string };
      select: { lastSeenAt: true };
    }): Promise<{ lastSeenAt: Date | null } | null>;
  };
}

export class PresenceService {
  private static readonly onlineUsersKey = 'presence:online_users';

  constructor(
    private readonly redis: PresenceRedisStore,
    private readonly prisma: PresencePrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async markOnline(userId: string, socketId: string): Promise<PresenceStatus> {
    const socketsKey = this.socketsKey(userId);
    const lastSeenAt = this.now();

    await this.redis.sadd(socketsKey, socketId);
    await this.redis.sadd(PresenceService.onlineUsersKey, userId);
    await this.redis.set(this.lastSeenKey(userId), lastSeenAt.toISOString());
    await this.persistLastSeen(userId, lastSeenAt);

    return {
      userId,
      online: true,
      lastSeenAt: lastSeenAt.toISOString(),
    };
  }

  async markOffline(userId: string, socketId: string): Promise<PresenceStatus> {
    const socketsKey = this.socketsKey(userId);
    await this.redis.srem(socketsKey, socketId);

    const remainingSockets = await this.redis.scard(socketsKey);
    const lastSeenAt = this.now();
    await this.redis.set(this.lastSeenKey(userId), lastSeenAt.toISOString());
    await this.persistLastSeen(userId, lastSeenAt);

    if (remainingSockets <= 0) {
      await this.redis.srem(PresenceService.onlineUsersKey, userId);
      await this.redis.del(socketsKey);
    }

    return {
      userId,
      online: remainingSockets > 0,
      lastSeenAt: lastSeenAt.toISOString(),
    };
  }

  async getStatus(userId: string): Promise<PresenceStatus> {
    const socketCount = await this.redis.scard(this.socketsKey(userId));
    const cachedLastSeen = await this.redis.get(this.lastSeenKey(userId));

    if (cachedLastSeen) {
      return {
        userId,
        online: socketCount > 0,
        lastSeenAt: cachedLastSeen,
      };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { lastSeenAt: true },
    });

    return {
      userId,
      online: socketCount > 0,
      lastSeenAt: user?.lastSeenAt?.toISOString() ?? null,
    };
  }

  async getManyStatuses(userIds: string[]): Promise<PresenceStatus[]> {
    const uniqueUserIds = [...new Set(userIds)];
    return Promise.all(uniqueUserIds.map((userId) => this.getStatus(userId)));
  }

  async getOnlineUserIds(): Promise<string[]> {
    return this.redis.smembers(PresenceService.onlineUsersKey);
  }

  private async persistLastSeen(userId: string, lastSeenAt: Date) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastSeenAt },
    });
  }

  private socketsKey(userId: string) {
    return `presence:user:${userId}:sockets`;
  }

  private lastSeenKey(userId: string) {
    return `presence:user:${userId}:last_seen`;
  }
}
