import { z } from 'zod';

const hexSchema = z.string().regex(/^[a-f0-9]+$/i);

export const ratchetHeaderSchema = z.object({
  dhPubKey: z.string().min(1),
  msgNum: z.number().int().min(0),
  prevMsgNum: z.number().int().min(0),
});

export const encryptedMessageEnvelopeSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal('X3DH-DOUBLE-RATCHET-AES-256-GCM'),
  ratchetHeader: ratchetHeaderSchema,
  iv: hexSchema,
  tag: hexSchema,
  sessionId: z.string().min(1).max(128).optional(),
  senderEphemeralPublicKey: z.string().min(1).optional(),
});

export type EncryptedMessageEnvelope = z.infer<typeof encryptedMessageEnvelopeSchema>;

export class E2EEService {
  static serializeEnvelope(encryptionHeader: string | EncryptedMessageEnvelope): string {
    const envelope =
      typeof encryptionHeader === 'string'
        ? this.parseEnvelope(encryptionHeader)
        : encryptionHeader;

    return JSON.stringify(encryptedMessageEnvelopeSchema.parse(envelope));
  }

  static parseEnvelope(encryptionHeader: string): EncryptedMessageEnvelope {
    let parsed: unknown;
    try {
      parsed = JSON.parse(encryptionHeader);
    } catch (err) {
      throw new Error('INVALID_ENCRYPTION_HEADER', { cause: err });
    }

    try {
      return encryptedMessageEnvelopeSchema.parse(parsed);
    } catch (err) {
      throw new Error('INVALID_ENCRYPTION_HEADER', { cause: err });
    }
  }

  static assertEncryptedDirectMessage(content: string, encryptionHeader: string | null) {
    if (!content || !content.trim()) throw new Error('MESSAGE_EMPTY');
    if (!encryptionHeader) throw new Error('INVALID_ENCRYPTION_HEADER');
    this.parseEnvelope(encryptionHeader);
  }
}
