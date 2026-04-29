import { E2EEService } from '@messaging/services/e2ee.service';

const validEnvelope = {
  version: 1,
  algorithm: 'X3DH-DOUBLE-RATCHET-AES-256-GCM',
  ratchetHeader: {
    dhPubKey: '-----BEGIN PUBLIC KEY-----\nkey\n-----END PUBLIC KEY-----',
    msgNum: 0,
    prevMsgNum: 0,
  },
  iv: 'aabbcc',
  tag: 'ddeeff',
};

describe('E2EEService', () => {
  it('parses and serializes Double Ratchet envelopes', () => {
    const serialized = E2EEService.serializeEnvelope(JSON.stringify(validEnvelope));

    expect(E2EEService.parseEnvelope(serialized)).toEqual(validEnvelope);
  });

  it('rejects malformed encryption headers', () => {
    expect(() => E2EEService.parseEnvelope('HEADER_DATA')).toThrow('INVALID_ENCRYPTION_HEADER');
    expect(() =>
      E2EEService.parseEnvelope(
        JSON.stringify({
          ...validEnvelope,
          ratchetHeader: { ...validEnvelope.ratchetHeader, msgNum: -1 },
        }),
      ),
    ).toThrow('INVALID_ENCRYPTION_HEADER');
  });
});
