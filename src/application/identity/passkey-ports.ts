export interface PasskeyRecord {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  deviceName: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export type WebauthnChallengePurpose = "registration" | "authentication";

export interface WebauthnChallenge {
  id: string;
  userId: string | null;
  purpose: WebauthnChallengePurpose;
  challengeHash: string;
  createdAt: string;
  expiresAt: string;
}

export interface PasskeyRepository {
  listForUser(userId: string): Promise<PasskeyRecord[]>;
  isDemoAccount(userId: string): Promise<boolean>;
  create(record: PasskeyRecord): Promise<boolean>;
  findLoginForUser(userId: string): Promise<string | null>;
  deleteForUser(id: string, userId: string): Promise<boolean>;
  // Credential lookup is only for the public authentication flow.
  findByCredentialId(credentialId: string): Promise<PasskeyRecord | null>;
  updateCounter(
    id: string,
    userId: string,
    previousCounter: number,
    newCounter: number,
    usedAt: Date,
  ): Promise<boolean>;
  createChallenge(challenge: WebauthnChallenge): Promise<void>;
  // Consumes a live, unused challenge atomically and checks its owner/purpose.
  consumeChallenge(
    id: string,
    purpose: WebauthnChallengePurpose,
    userId: string | null,
    now: Date,
  ): Promise<WebauthnChallenge | null>;
}
