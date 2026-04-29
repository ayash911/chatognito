import { PresenceService, type PresencePrismaClient } from '@gateway/services/presence.service';

class FakePresenceRedis {
  sets = new Map<string, Set<string>>();
  values = new Map<string, string>();

  async sadd(key: string, ...members: string[]) {
    const set = this.sets.get(key) ?? new Set<string>();
    const before = set.size;
    members.forEach((member) => set.add(member));
    this.sets.set(key, set);
    return set.size - before;
  }

  async srem(key: string, ...members: string[]) {
    const set = this.sets.get(key) ?? new Set<string>();
    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) removed += 1;
    }
    this.sets.set(key, set);
    return removed;
  }

  async scard(key: string) {
    return this.sets.get(key)?.size ?? 0;
  }

  async smembers(key: string) {
    return [...(this.sets.get(key) ?? new Set<string>())];
  }

  async set(key: string, value: string) {
    this.values.set(key, value);
    return 'OK';
  }

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async del(key: string) {
    const existed = this.sets.delete(key);
    return existed ? 1 : 0;
  }
}

describe('PresenceService', () => {
  const now = new Date('2026-04-29T10:00:00.000Z');
  let redis: FakePresenceRedis;
  let prisma: PresencePrismaClient;
  let service: PresenceService;

  beforeEach(() => {
    redis = new FakePresenceRedis();
    prisma = {
      user: {
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ lastSeenAt: now }),
      },
    };
    service = new PresenceService(redis, prisma, () => now);
  });

  it('keeps a user online until all sockets disconnect', async () => {
    await service.markOnline('user-1', 'socket-1');
    await service.markOnline('user-1', 'socket-2');

    const stillOnline = await service.markOffline('user-1', 'socket-1');
    expect(stillOnline.online).toBe(true);

    const offline = await service.markOffline('user-1', 'socket-2');
    expect(offline.online).toBe(false);
    expect(prisma.user.update).toHaveBeenCalledTimes(4);
  });

  it('returns cached last seen before falling back to the database', async () => {
    await service.markOnline('user-1', 'socket-1');

    const cached = await service.getStatus('user-1');
    expect(cached).toEqual({
      userId: 'user-1',
      online: true,
      lastSeenAt: now.toISOString(),
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to the database when no cached last seen exists', async () => {
    const status = await service.getStatus('user-1');

    expect(status).toEqual({
      userId: 'user-1',
      online: false,
      lastSeenAt: now.toISOString(),
    });
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });
});
