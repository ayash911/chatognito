import crypto from 'crypto';
import { CryptoPrimitives } from '@chatognito/crypto';
import type { SignedSocketPacket } from '../types';

const PACKET_KEY_INFO = 'chatognito.gateway.packet.v1';
const HANDSHAKE_PROOF_EVENT = 'security:handshake:ack';

export interface PacketNonceStore {
  claim(key: string, ttlSeconds: number): Promise<boolean>;
}

export class InMemoryNonceStore implements PacketNonceStore {
  private readonly claimed = new Map<string, NodeJS.Timeout>();

  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    if (this.claimed.has(key)) return false;

    const timeout = setTimeout(() => {
      this.claimed.delete(key);
    }, ttlSeconds * 1000);

    if (typeof timeout.unref === 'function') {
      timeout.unref();
    }

    this.claimed.set(key, timeout);
    return true;
  }

  clear() {
    for (const timeout of this.claimed.values()) {
      clearTimeout(timeout);
    }
    this.claimed.clear();
  }
}

export interface RedisLikeNonceStore {
  set(
    key: string,
    value: string,
    expiryMode: 'EX',
    ttlSeconds: number,
    setMode: 'NX',
  ): Promise<'OK' | null>;
}

export class RedisNonceStore implements PacketNonceStore {
  constructor(private readonly redis: RedisLikeNonceStore) {}

  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }
}

export class PacketIntegrityService {
  private static readonly maxClockSkewMs = 2 * 60 * 1000;
  private static readonly nonceTtlSeconds = 5 * 60;

  static async generateEphemeralKeyPair() {
    return CryptoPrimitives.generateDHKeyPair();
  }

  static derivePacketKey(serverPrivateKey: string, clientPublicKey: string, challenge: string) {
    const sharedSecret = CryptoPrimitives.diffieHellman(serverPrivateKey, clientPublicKey);
    return Buffer.from(
      crypto.hkdfSync('sha256', sharedSecret, Buffer.from(challenge), PACKET_KEY_INFO, 32),
    );
  }

  static sign<TData>(
    packetKey: Buffer,
    event: string,
    packet: Omit<SignedSocketPacket<TData>, 'signature'>,
  ) {
    return crypto
      .createHmac('sha256', packetKey)
      .update(this.canonicalPayload(event, packet))
      .digest('hex');
  }

  static buildPacket<TData>(
    packetKey: Buffer,
    event: string,
    data: TData,
    overrides: Partial<Pick<SignedSocketPacket<TData>, 'nonce' | 'timestamp'>> = {},
  ): SignedSocketPacket<TData> {
    const unsignedPacket = {
      nonce: overrides.nonce ?? crypto.randomUUID(),
      timestamp: overrides.timestamp ?? Date.now(),
      data,
    };

    return {
      ...unsignedPacket,
      signature: this.sign(packetKey, event, unsignedPacket),
    };
  }

  static signHandshakeProof(packetKey: Buffer, userId: string, challenge: string) {
    return crypto
      .createHmac('sha256', packetKey)
      .update(this.stableStringify({ challenge, event: HANDSHAKE_PROOF_EVENT, userId }))
      .digest('hex');
  }

  static verifyHandshakeProof(
    packetKey: Buffer,
    userId: string,
    challenge: string,
    signature: string,
  ) {
    this.assertHexSignature(signature);
    const expected = this.signHandshakeProof(packetKey, userId, challenge);
    if (!this.timingSafeEqualHex(expected, signature)) {
      throw new Error('PACKET_SIGNATURE_INVALID');
    }
  }

  static async verify<TData>(
    packetKey: Buffer | undefined,
    event: string,
    packet: SignedSocketPacket<TData>,
    nonceStore: PacketNonceStore,
    nonceNamespace: string,
  ): Promise<TData> {
    if (!packetKey) throw new Error('PACKET_INTEGRITY_NOT_NEGOTIATED');
    if (!packet || typeof packet !== 'object') throw new Error('PACKET_INVALID');
    if (!packet.nonce || typeof packet.nonce !== 'string') throw new Error('PACKET_NONCE_INVALID');
    if (typeof packet.timestamp !== 'number') throw new Error('PACKET_TIMESTAMP_INVALID');
    this.assertHexSignature(packet.signature);

    const drift = Math.abs(Date.now() - packet.timestamp);
    if (drift > this.maxClockSkewMs) throw new Error('PACKET_TIMESTAMP_INVALID');

    const expected = this.sign(packetKey, event, {
      nonce: packet.nonce,
      timestamp: packet.timestamp,
      data: packet.data,
    });

    if (!this.timingSafeEqualHex(expected, packet.signature)) {
      throw new Error('PACKET_SIGNATURE_INVALID');
    }

    const nonceKey = `${nonceNamespace}:${packet.nonce}`;
    const claimed = await nonceStore.claim(nonceKey, this.nonceTtlSeconds);
    if (!claimed) throw new Error('PACKET_REPLAYED');

    return packet.data;
  }

  private static canonicalPayload<TData>(
    event: string,
    packet: Omit<SignedSocketPacket<TData>, 'signature'>,
  ) {
    return this.stableStringify({
      data: packet.data,
      event,
      nonce: packet.nonce,
      timestamp: packet.timestamp,
    });
  }

  private static stableStringify(value: unknown): string {
    return JSON.stringify(this.sortValue(value));
  }

  private static sortValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sortValue(item));
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nestedValue]) => [key, this.sortValue(nestedValue)]),
      );
    }

    return value;
  }

  private static assertHexSignature(signature: string) {
    if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) {
      throw new Error('PACKET_SIGNATURE_INVALID');
    }
  }

  private static timingSafeEqualHex(expectedHex: string, actualHex: string) {
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = Buffer.from(actualHex, 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }
}
