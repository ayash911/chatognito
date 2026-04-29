import * as crypto from 'crypto';
import { promisify } from 'util';
import type { DHKeyPair, EncryptionResult, SigningKeyPair } from './types';

const generateKeyPair = promisify(crypto.generateKeyPair);

export class CryptoPrimitives {
  /**
   * Generates a new X25519 key pair for DH operations
   */
  static async generateDHKeyPair(): Promise<DHKeyPair> {
    const { publicKey, privateKey } = await generateKeyPair('x25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return { public: publicKey, private: privateKey };
  }

  /**
   * Generates a new Ed25519 key pair for signing
   */
  static async generateSigningKeyPair(): Promise<SigningKeyPair> {
    const { publicKey, privateKey } = await generateKeyPair('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return { public: publicKey, private: privateKey };
  }

  /**
   * Performs Diffie-Hellman key agreement
   */
  static diffieHellman(privateKey: string, publicKey: string): Buffer {
    return crypto.diffieHellman({
      privateKey: crypto.createPrivateKey(privateKey),
      publicKey: crypto.createPublicKey(publicKey),
    });
  }

  /**
   * HKDF key derivation (using HMAC-SHA256)
   */
  static hkdf(secret: Buffer, salt: Buffer, info: string, length: number): Buffer {
    return Buffer.from(crypto.hkdfSync('sha256', secret, salt, info, length));
  }

  /**
   * Encrypts data using AES-256-GCM
   */
  static encrypt(key: Buffer, plaintext: string): EncryptionResult {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');

    return {
      ciphertext,
      iv: iv.toString('hex'),
      tag,
    };
  }

  /**
   * Decrypts data using AES-256-GCM
   */
  static decrypt(key: Buffer, ciphertext: string, iv: string, tag: string): string {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');
    return plaintext;
  }

  /**
   * Sign data using Ed25519
   */
  static sign(privateKey: string, data: Buffer): Buffer {
    return crypto.sign(null, data, crypto.createPrivateKey(privateKey));
  }

  /**
   * Verify Ed25519 signature
   */
  static verify(publicKey: string, data: Buffer, signature: Buffer): boolean {
    return crypto.verify(null, data, crypto.createPublicKey(publicKey), signature);
  }
}
