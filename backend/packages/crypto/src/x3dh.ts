import { CryptoPrimitives } from './primitives';
import type { DHKeyPair } from './types';

export class X3DH {
  /**
   * Alice initiates a session with Bob
   */
  static async AliceInitiate(
    aliceIK: DHKeyPair,
    aliceEK: DHKeyPair,
    bobIK_DH: string,
    bobIK_Sign: string,
    bobSPK: string,
    bobSPKSignature: string,
    bobOPK?: string,
  ): Promise<{ sharedSecret: Buffer; initialDHKeyPair: DHKeyPair }> {
    // 0. Verify Bob's Signed Pre-key signature
    const isSignatureValid = CryptoPrimitives.verify(
      bobIK_Sign,
      Buffer.from(bobSPK),
      Buffer.from(bobSPKSignature, 'hex'),
    );
    if (!isSignatureValid) throw new Error('INVALID_SIGNED_PREKEY_SIGNATURE');

    // DH1 = DH(aliceIK, bobSPK)
    const dh1 = CryptoPrimitives.diffieHellman(aliceIK.private, bobSPK);
    // DH2 = DH(aliceEK, bobIK_DH)
    const dh2 = CryptoPrimitives.diffieHellman(aliceEK.private, bobIK_DH);
    // DH3 = DH(aliceEK, bobSPK)
    const dh3 = CryptoPrimitives.diffieHellman(aliceEK.private, bobSPK);

    let secret = Buffer.concat([dh1, dh2, dh3]);

    if (bobOPK) {
      // DH4 = DH(aliceEK, bobOPK)
      const dh4 = CryptoPrimitives.diffieHellman(aliceEK.private, bobOPK);
      secret = Buffer.concat([secret, dh4]);
    }

    const sharedSecret = CryptoPrimitives.hkdf(secret, Buffer.alloc(32), 'X3DH_INITIAL', 32);

    return {
      sharedSecret,
      initialDHKeyPair: aliceEK,
    };
  }

  /**
   * Bob responds to Alice's initiation
   */
  static async BobRespond(
    bobIK: DHKeyPair,
    bobSPK: DHKeyPair,
    aliceIK: string,
    aliceEK: string,
    bobOPK?: DHKeyPair,
  ): Promise<Buffer> {
    const dh1 = CryptoPrimitives.diffieHellman(bobSPK.private, aliceIK);
    const dh2 = CryptoPrimitives.diffieHellman(bobIK.private, aliceEK);
    const dh3 = CryptoPrimitives.diffieHellman(bobSPK.private, aliceEK);

    let secret = Buffer.concat([dh1, dh2, dh3]);

    if (bobOPK) {
      const dh4 = CryptoPrimitives.diffieHellman(bobOPK.private, aliceEK);
      secret = Buffer.concat([secret, dh4]);
    }

    return CryptoPrimitives.hkdf(secret, Buffer.alloc(32), 'X3DH_INITIAL', 32);
  }
}
