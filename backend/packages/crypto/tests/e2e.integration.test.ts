import { CryptoPrimitives, DoubleRatchet, X3DH } from '../src/index';
import type { RatchetState } from '../src/index';

describe('E2EE End-to-End Flow', () => {
  it('should successfully establish a session and exchange messages between Alice and Bob', async () => {
    // 1. SETUP: Alice and Bob generate their Identity Keys
    const aliceIK = await CryptoPrimitives.generateDHKeyPair();
    const bobIK = await CryptoPrimitives.generateDHKeyPair();

    const bobSigningKey = await CryptoPrimitives.generateSigningKeyPair();
    const bobSPK = await CryptoPrimitives.generateDHKeyPair();
    const bobSPKSignature = CryptoPrimitives.sign(
      bobSigningKey.private,
      Buffer.from(bobSPK.public),
    ).toString('hex');
    const bobOPK = await CryptoPrimitives.generateDHKeyPair();

    // 3. HANDSHAKE: Alice fetches Bob's bundle and initiates X3DH
    const aliceEK = await CryptoPrimitives.generateDHKeyPair();
    const aliceResult = await X3DH.AliceInitiate(
      aliceIK,
      aliceEK,
      bobIK.public,
      bobSigningKey.public,
      bobSPK.public,
      bobSPKSignature,
      bobOPK.public,
    );

    // 4. HANDSHAKE: Bob receives Alice's initiation (IK, EK) and responds
    const bobSharedSecret = await X3DH.BobRespond(
      bobIK,
      bobSPK,
      aliceIK.public,
      aliceEK.public,
      bobOPK,
    );

    // Verify shared secrets match
    expect(aliceResult.sharedSecret).toEqual(bobSharedSecret);

    // 5. DOUBLE RATCHET: Initialize states
    const aliceState: RatchetState = await DoubleRatchet.initializeAliceState(
      aliceResult.sharedSecret,
      bobSPK.public,
    );

    const bobState: RatchetState = DoubleRatchet.initializeBobState(bobSharedSecret, bobSPK);

    const msg1 = await DoubleRatchet.encrypt(aliceState, 'Hello Bob! Secure channel established.');

    // Bob decrypts msg1
    const decrypted1 = await DoubleRatchet.decrypt(
      bobState,
      msg1.header,
      msg1.ciphertext,
      msg1.iv,
      msg1.tag,
    );
    expect(decrypted1).toBe('Hello Bob! Secure channel established.');

    // Bob replies (this triggers a DH ratchet step on Alice's end when she receives it)
    const msg2 = await DoubleRatchet.encrypt(
      bobState,
      'Confirmed. Perfect forward secrecy active.',
    );

    // Alice decrypts msg2
    const decrypted2 = await DoubleRatchet.decrypt(
      aliceState,
      msg2.header,
      msg2.ciphertext,
      msg2.iv,
      msg2.tag,
    );
    expect(decrypted2).toBe('Confirmed. Perfect forward secrecy active.');

    // Alice sends another message (Symmetric ratchet only)
    const msg3 = await DoubleRatchet.encrypt(aliceState, "Let's test out-of-order delivery.");
    const msg4 = await DoubleRatchet.encrypt(aliceState, 'I am msg #4');

    // Bob receives msg4 before msg3
    const decrypted4 = await DoubleRatchet.decrypt(
      bobState,
      msg4.header,
      msg4.ciphertext,
      msg4.iv,
      msg4.tag,
    );
    expect(decrypted4).toBe('I am msg #4');

    // Bob now receives msg3
    const decrypted3 = await DoubleRatchet.decrypt(
      bobState,
      msg3.header,
      msg3.ciphertext,
      msg3.iv,
      msg3.tag,
    );
    expect(decrypted3).toBe("Let's test out-of-order delivery.");
  });
});
