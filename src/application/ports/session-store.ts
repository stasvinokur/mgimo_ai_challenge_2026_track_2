export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
}

export interface SessionStore {
  // Only the SHA-256 hash crosses the persistence boundary.
  create(session: SessionRecord): Promise<void>;
  findValid(tokenHash: string, now: Date): Promise<SessionRecord | null>;
  touch(id: string, lastSeenAt: Date, expiresAt: Date): Promise<void>;
  revoke(id: string): Promise<void>;
}
