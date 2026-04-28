import { CryptoPrimitives, DoubleRatchet, X3DH } from '../src/index.js';
import type { RatchetState } from '../src/index.js';

describe('E2EE Edge Cases and Reliability', () => {
  let aliceIK: any,
    bobIK: any,
    bobSigningKey: any,
    bobSPK: any,
    bobOPK: any,
    bobSPKSignature: string;
  let aliceResult: any, bobSharedSecret: any;

  beforeAll(async () => {
    // Standard setup for tests
    aliceIK = await CryptoPrimitives.generateDHKeyPair();
    bobIK = await CryptoPrimitives.generateDHKeyPair();
    bobSigningKey = await CryptoPrimitives.generateSigningKeyPair();

    bobSPK = await CryptoPrimitives.generateDHKeyPair();
    bobSPKSignature = CryptoPrimitives.sign(
      bobSigningKey.private,
      Buffer.from(bobSPK.public),
    ).toString('hex');
    bobOPK = await CryptoPrimitives.generateDHKeyPair();

    // HANDSHAKE
    const aliceEK = await CryptoPrimitives.generateDHKeyPair();
    aliceResult = await X3DH.AliceInitiate(
      aliceIK,
      aliceEK,
      bobIK.public,
      bobSigningKey.public,
      bobSPK.public,
      bobSPKSignature,
      bobOPK.public,
    );

    bobSharedSecret = await X3DH.BobRespond(bobIK, bobSPK, aliceIK.public, aliceEK.public, bobOPK);
  });

  const createInitialStates = async () => {
    const aliceState: RatchetState = {
      rootKey: aliceResult.sharedSecret,
      sendChainKey: null,
      recvChainKey: null,
      sendDHKeyPair: await CryptoPrimitives.generateDHKeyPair(),
      recvDHPublicKey: bobSPK.public,
      sendMsgNum: 0,
      recvMsgNum: 0,
      prevSendMsgNum: 0,
      skippedMsgKeys: {},
    };

    const bobState: RatchetState = {
      rootKey: bobSharedSecret,
      sendChainKey: null,
      recvChainKey: null,
      sendDHKeyPair: bobSPK,
      recvDHPublicKey: null,
      sendMsgNum: 0,
      recvMsgNum: 0,
      prevSendMsgNum: 0,
      skippedMsgKeys: {},
    };

    // Initialize Alice's first sending chain
    const dhAlice = CryptoPrimitives.diffieHellman(
      aliceState.sendDHKeyPair.private,
      aliceState.recvDHPublicKey!,
    );
    const aliceKDF = DoubleRatchet.KDF_RK(aliceState.rootKey, dhAlice);
    aliceState.rootKey = aliceKDF.nextRootKey;
    aliceState.sendChainKey = aliceKDF.chainKey;

    return { aliceState, bobState };
  };

  it('should fail to decrypt if ciphertext is tampered', async () => {
    const { aliceState, bobState } = await createInitialStates();
    const msg = await DoubleRatchet.encrypt(aliceState, 'Original message');

    // Tamper with ciphertext
    const tamperedCiphertext = msg.ciphertext.substring(0, msg.ciphertext.length - 2) + '00';

    await expect(
      DoubleRatchet.decrypt(bobState, msg.header, tamperedCiphertext, msg.iv, msg.tag),
    ).rejects.toThrow();
  });

  it('should fail to decrypt if tag is tampered', async () => {
    const { aliceState, bobState } = await createInitialStates();
    const msg = await DoubleRatchet.encrypt(aliceState, 'Original message');

    const tamperedTag = msg.tag.substring(0, msg.tag.length - 2) + 'ff';

    await expect(
      DoubleRatchet.decrypt(bobState, msg.header, msg.ciphertext, msg.iv, tamperedTag),
    ).rejects.toThrow();
  });

  it('should handle duplicate messages correctly (prevent replay)', async () => {
    const { aliceState, bobState } = await createInitialStates();
    const msg = await DoubleRatchet.encrypt(aliceState, 'Message 1');

    // First delivery works
    const dec1 = await DoubleRatchet.decrypt(bobState, msg.header, msg.ciphertext, msg.iv, msg.tag);
    expect(dec1).toBe('Message 1');

    // Second delivery of same message should fail (because the symmetric ratchet advanced)
    await expect(
      DoubleRatchet.decrypt(bobState, msg.header, msg.ciphertext, msg.iv, msg.tag),
    ).rejects.toThrow();
  });

  it('should enforce MAX_SKIP limit', async () => {
    const { aliceState, bobState } = await createInitialStates();

    // Alice sends 1002 messages
    for (let i = 0; i < 1001; i++) {
      await DoubleRatchet.encrypt(aliceState, `Msg ${i}`);
    }
    const msg1002 = await DoubleRatchet.encrypt(aliceState, 'Msg 1002');

    // Bob receives msg 1002, but he's at msg 0. He needs to skip 1001 keys.
    // Our MAX_SKIP is 1000.

    await expect(
      DoubleRatchet.decrypt(bobState, msg1002.header, msg1002.ciphertext, msg1002.iv, msg1002.tag),
    ).rejects.toThrow('TOO_MANY_SKIPPED_MESSAGES');
  });

  it('should handle long-term session with multiple DH ratchet steps', async () => {
    const { aliceState, bobState } = await createInitialStates();

    // Flow: Alice -> Bob -> Alice -> Bob -> Alice

    // 1. Alice -> Bob
    const msgA1 = await DoubleRatchet.encrypt(aliceState, 'A1');
    expect(
      await DoubleRatchet.decrypt(bobState, msgA1.header, msgA1.ciphertext, msgA1.iv, msgA1.tag),
    ).toBe('A1');

    // 2. Bob -> Alice
    const msgB1 = await DoubleRatchet.encrypt(bobState, 'B1');
    expect(
      await DoubleRatchet.decrypt(aliceState, msgB1.header, msgB1.ciphertext, msgB1.iv, msgB1.tag),
    ).toBe('B1');

    // 3. Alice -> Bob
    const msgA2 = await DoubleRatchet.encrypt(aliceState, 'A2');
    expect(
      await DoubleRatchet.decrypt(bobState, msgA2.header, msgA2.ciphertext, msgA2.iv, msgA2.tag),
    ).toBe('A2');

    // 4. Bob -> Alice
    const msgB2 = await DoubleRatchet.encrypt(bobState, 'B2');
    expect(
      await DoubleRatchet.decrypt(aliceState, msgB2.header, msgB2.ciphertext, msgB2.iv, msgB2.tag),
    ).toBe('B2');

    expect(aliceState.sendMsgNum).toBe(0);
    expect(bobState.sendMsgNum).toBe(1);
  });
});
