import { CryptoPrimitives } from '../src/primitives';

describe('CryptoPrimitives', () => {
  it('should generate DH key pairs', async () => {
    const keys = await CryptoPrimitives.generateDHKeyPair();
    expect(keys.public).toBeDefined();
    expect(keys.private).toBeDefined();
  });

  it('should generate Signing key pairs', async () => {
    const keys = await CryptoPrimitives.generateSigningKeyPair();
    expect(keys.public).toBeDefined();
    expect(keys.private).toBeDefined();
  });

  it('should encrypt and decrypt correctly', async () => {
    const key = Buffer.alloc(32, 'a');
    const plaintext = 'Secret Message';
    const encrypted = CryptoPrimitives.encrypt(key, plaintext);
    const decrypted = CryptoPrimitives.decrypt(
      key,
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.tag,
    );
    expect(decrypted).toBe(plaintext);
  });

  it('should perform Diffie-Hellman', async () => {
    const alice = await CryptoPrimitives.generateDHKeyPair();
    const bob = await CryptoPrimitives.generateDHKeyPair();

    const secret1 = CryptoPrimitives.diffieHellman(alice.private, bob.public);
    const secret2 = CryptoPrimitives.diffieHellman(bob.private, alice.public);

    expect(secret1).toEqual(secret2);
  });

  it('should sign and verify signatures', async () => {
    const keys = await CryptoPrimitives.generateSigningKeyPair();
    const data = Buffer.from('Important Data');
    const signature = CryptoPrimitives.sign(keys.private, data);
    const isValid = CryptoPrimitives.verify(keys.public, data, signature);
    expect(isValid).toBe(true);
  });
});
