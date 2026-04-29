import { CryptoPrimitives } from '@chatognito/crypto';
import {
  InMemoryNonceStore,
  PacketIntegrityService,
} from '@gateway/services/packet-integrity.service';

describe('PacketIntegrityService', () => {
  let nonceStore: InMemoryNonceStore;

  beforeEach(() => {
    nonceStore = new InMemoryNonceStore();
  });

  afterEach(() => {
    nonceStore.clear();
  });

  it('derives matching packet keys over an ephemeral ECDH exchange', async () => {
    const serverKeys = await CryptoPrimitives.generateDHKeyPair();
    const clientKeys = await CryptoPrimitives.generateDHKeyPair();
    const challenge = 'challenge-1';

    const serverKey = PacketIntegrityService.derivePacketKey(
      serverKeys.private,
      clientKeys.public,
      challenge,
    );
    const clientKey = PacketIntegrityService.derivePacketKey(
      clientKeys.private,
      serverKeys.public,
      challenge,
    );

    expect(serverKey).toEqual(clientKey);
  });

  it('verifies signed packets and rejects replayed nonces', async () => {
    const packetKey = Buffer.alloc(32, 7);
    const packet = PacketIntegrityService.buildPacket(packetKey, 'presence:get', {
      nested: { b: 2, a: 1 },
    });

    await expect(
      PacketIntegrityService.verify(packetKey, 'presence:get', packet, nonceStore, 'test:user-1'),
    ).resolves.toEqual({ nested: { b: 2, a: 1 } });

    await expect(
      PacketIntegrityService.verify(packetKey, 'presence:get', packet, nonceStore, 'test:user-1'),
    ).rejects.toThrow('PACKET_REPLAYED');
  });

  it('rejects tampered packet data', async () => {
    const packetKey = Buffer.alloc(32, 3);
    const packet = PacketIntegrityService.buildPacket(packetKey, 'dm:send', {
      content: 'ciphertext-a',
    });

    await expect(
      PacketIntegrityService.verify(
        packetKey,
        'dm:send',
        { ...packet, data: { content: 'ciphertext-b' } },
        nonceStore,
        'test:user-1',
      ),
    ).rejects.toThrow('PACKET_SIGNATURE_INVALID');
  });

  it('verifies the ECDH handshake proof', () => {
    const packetKey = Buffer.alloc(32, 9);
    const signature = PacketIntegrityService.signHandshakeProof(packetKey, 'user-1', 'challenge-1');

    expect(() =>
      PacketIntegrityService.verifyHandshakeProof(packetKey, 'user-1', 'challenge-1', signature),
    ).not.toThrow();
  });
});
