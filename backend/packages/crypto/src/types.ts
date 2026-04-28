export interface DHKeyPair {
  public: string;
  private: string;
}

export interface SigningKeyPair {
  public: string;
  private: string;
}

export interface KeyBundle {
  userId: string;
  identityPublicKey: string;
  signedPreKey: string;
  signedPreKeySignature: string;
  oneTimePreKeys: string[];
}

export interface EncryptionResult {
  ciphertext: string;
  iv: string;
  tag: string;
}

export interface RatchetHeader {
  dhPubKey: string;
  msgNum: number;
  prevMsgNum: number;
}

export interface RatchetState {
  rootKey: Buffer;
  sendChainKey: Buffer | null;
  recvChainKey: Buffer | null;
  sendDHKeyPair: DHKeyPair;
  recvDHPublicKey: string | null;
  sendMsgNum: number;
  recvMsgNum: number;
  prevSendMsgNum: number;
  skippedMsgKeys: Record<string, Buffer>;
}
