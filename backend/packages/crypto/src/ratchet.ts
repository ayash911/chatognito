import { CryptoPrimitives } from './primitives';
import type { EncryptionResult, RatchetHeader, RatchetState } from './types';

export class DoubleRatchet {
  private static readonly MAX_SKIP = 1000;

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
