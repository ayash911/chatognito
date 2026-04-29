import { CryptoPrimitives } from './primitives';
import type { DHKeyPair, EncryptionResult, RatchetHeader, RatchetState } from './types';

export class DoubleRatchet {
  private static readonly MAX_SKIP = 1000;

  /**
   * Creates Alice's first sending state after X3DH. This performs the initial
   * DH ratchet step so the first outbound DM is immediately encryptable.
   */
  static async initializeAliceState(
    sharedSecret: Buffer,
    bobInitialDHPublicKey: string,
  ): Promise<RatchetState> {
    const state: RatchetState = {
      rootKey: Buffer.from(sharedSecret),
      sendChainKey: null,
      recvChainKey: null,
      sendDHKeyPair: await CryptoPrimitives.generateDHKeyPair(),
      recvDHPublicKey: bobInitialDHPublicKey,
      sendMsgNum: 0,
      recvMsgNum: 0,
      prevSendMsgNum: 0,
      skippedMsgKeys: {},
    };

    this.initializeSendingChain(state);
    return state;
  }

  /**
   * Creates Bob's receiving state after X3DH. Bob's first sending chain is
   * created automatically when he receives Alice's first ratchet header.
   */
  static initializeBobState(sharedSecret: Buffer, bobSignedPreKey: DHKeyPair): RatchetState {
    return {
      rootKey: Buffer.from(sharedSecret),
      sendChainKey: null,
      recvChainKey: null,
      sendDHKeyPair: bobSignedPreKey,
      recvDHPublicKey: null,
      sendMsgNum: 0,
      recvMsgNum: 0,
      prevSendMsgNum: 0,
      skippedMsgKeys: {},
    };
  }

  static initializeSendingChain(state: RatchetState) {
    if (!state.recvDHPublicKey) throw new Error('RECV_DH_NOT_INITIALIZED');
    const dhOutput = CryptoPrimitives.diffieHellman(
      state.sendDHKeyPair.private,
      state.recvDHPublicKey,
    );
    const { nextRootKey, chainKey } = this.KDF_RK(state.rootKey, dhOutput);
    state.rootKey = nextRootKey;
    state.sendChainKey = chainKey;
  }

  /**
   * Derives a Message Key from a Chain Key and advances the Chain Key
   */
  static KDF_CK(chainKey: Buffer): { messageKey: Buffer; nextChainKey: Buffer } {
    const messageKey = CryptoPrimitives.hkdf(chainKey, Buffer.alloc(32), 'MESSAGE_KEY', 32);
    const nextChainKey = CryptoPrimitives.hkdf(chainKey, Buffer.alloc(32), 'CHAIN_KEY', 32);
    return { messageKey, nextChainKey };
  }

  /**
   * Advances the Root Key and produces a new Chain Key
   */
  static KDF_RK(rootKey: Buffer, dhOutput: Buffer): { nextRootKey: Buffer; chainKey: Buffer } {
    const derived = CryptoPrimitives.hkdf(rootKey, dhOutput, 'ROOT_RATCHET', 64);
    return {
      nextRootKey: derived.subarray(0, 32),
      chainKey: derived.subarray(32, 64),
    };
  }

  /**
   * Encrypt a message and advance the sending chain
   */
  static async encrypt(
    state: RatchetState,
    plaintext: string,
  ): Promise<EncryptionResult & { header: RatchetHeader }> {
    if (!state.sendChainKey) throw new Error('SEND_CHAIN_NOT_INITIALIZED');

    const { messageKey, nextChainKey } = this.KDF_CK(state.sendChainKey);
    state.sendChainKey = nextChainKey;

    const header: RatchetHeader = {
      dhPubKey: state.sendDHKeyPair.public,
      msgNum: state.sendMsgNum,
      prevMsgNum: state.prevSendMsgNum,
    };

    state.sendMsgNum++;

    const encryption = CryptoPrimitives.encrypt(messageKey, plaintext);

    return {
      header,
      ...encryption,
    };
  }

  /**
   * Decrypt a message and advance the receiving chain (including skipping)
   */
  static async decrypt(
    state: RatchetState,
    header: RatchetHeader,
    ciphertext: string,
    iv: string,
    tag: string,
  ): Promise<string> {
    // 1. Try to find a skipped message key
    const skipId = `${header.dhPubKey}:${header.msgNum}`;
    if (state.skippedMsgKeys[skipId]) {
      const msgKey = state.skippedMsgKeys[skipId];
      delete state.skippedMsgKeys[skipId];
      return CryptoPrimitives.decrypt(msgKey, ciphertext, iv, tag);
    }

    // 2. DH Ratchet step
    if (header.dhPubKey !== state.recvDHPublicKey) {
      await this.skipMessageKeys(state, header.prevMsgNum);
      await this.dhRatchet(state, header.dhPubKey);
    }

    // 3. Symmetric-key Ratchet skip
    await this.skipMessageKeys(state, header.msgNum);

    // 4. Decrypt and advance
    if (!state.recvChainKey) throw new Error('RECV_CHAIN_NOT_INITIALIZED');
    const { messageKey, nextChainKey } = this.KDF_CK(state.recvChainKey);
    state.recvChainKey = nextChainKey;
    state.recvMsgNum++;

    return CryptoPrimitives.decrypt(messageKey, ciphertext, iv, tag);
  }

  private static async dhRatchet(state: RatchetState, newHeaderPubKey: string) {
    state.prevSendMsgNum = state.sendMsgNum;
    state.sendMsgNum = 0;
    state.recvMsgNum = 0;
    state.recvDHPublicKey = newHeaderPubKey;

    // RK Step for Receiving Chain
    const dhOutputRecv = CryptoPrimitives.diffieHellman(
      state.sendDHKeyPair.private,
      state.recvDHPublicKey,
    );
    const resRecv = this.KDF_RK(state.rootKey, dhOutputRecv);
    state.rootKey = resRecv.nextRootKey;
    state.recvChainKey = resRecv.chainKey;

    // Generate new DH Key for Sending Chain
    state.sendDHKeyPair = await CryptoPrimitives.generateDHKeyPair();

    // RK Step for Sending Chain
    const dhOutputSend = CryptoPrimitives.diffieHellman(
      state.sendDHKeyPair.private,
      state.recvDHPublicKey,
    );
    const resSend = this.KDF_RK(state.rootKey, dhOutputSend);
    state.rootKey = resSend.nextRootKey;
    state.sendChainKey = resSend.chainKey;
  }

  private static async skipMessageKeys(state: RatchetState, untilNum: number) {
    if (state.recvMsgNum + this.MAX_SKIP < untilNum) throw new Error('TOO_MANY_SKIPPED_MESSAGES');

    while (state.recvMsgNum < untilNum) {
      if (!state.recvChainKey) break;
      const { messageKey, nextChainKey } = this.KDF_CK(state.recvChainKey);
      const skipId = `${state.recvDHPublicKey}:${state.recvMsgNum}`;
      state.skippedMsgKeys[skipId] = messageKey;
      state.recvChainKey = nextChainKey;
      state.recvMsgNum++;
    }
  }
}
