import type { Sql } from "postgres";
import type {
  SessionRecord,
  SessionStore,
} from "@/application/ports/session-store";
import {
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_TOUCH_INTERVAL_MS,
} from "@/domain/identity/session-policy";

export class PostgresSessionStore implements SessionStore {
  constructor(private readonly database: () => Sql) {}

  async create(session: SessionRecord): Promise<void> {
    await this.database()`insert into sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at) values (${session.id}, ${session.userId}, ${session.tokenHash}, ${session.createdAt}::timestamptz, ${session.expiresAt}::timestamptz, ${session.lastSeenAt}::timestamptz)`;
  }

  async findValid(tokenHash: string, now: Date): Promise<SessionRecord | null> {
    const [row] = await this.database()<
      {
        id: string;
        userId: string;
        tokenHash: string;
        createdAt: Date;
        expiresAt: Date;
        lastSeenAt: Date;
      }[]
    >`select id, user_id as "userId", token_hash as "tokenHash", created_at as "createdAt", expires_at as "expiresAt", last_seen_at as "lastSeenAt" from sessions where token_hash = ${tokenHash} and expires_at > ${now.toISOString()}::timestamptz and created_at > ${new Date(now.getTime() - SESSION_ABSOLUTE_TTL_MS).toISOString()}::timestamptz`;
    return row
      ? {
          ...row,
          createdAt: row.createdAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
          lastSeenAt: row.lastSeenAt.toISOString(),
        }
      : null;
  }

  async touch(id: string, lastSeenAt: Date, expiresAt: Date): Promise<void> {
    const cutoff = new Date(
      lastSeenAt.getTime() - SESSION_TOUCH_INTERVAL_MS,
    ).toISOString();
    // Concurrent requests cannot move expiry backwards or write on every read.
    await this.database()`update sessions set last_seen_at = ${lastSeenAt.toISOString()}::timestamptz, expires_at = least(${expiresAt.toISOString()}::timestamptz, created_at + ${SESSION_ABSOLUTE_TTL_MS / 1000} * interval '1 second') where id = ${id} and last_seen_at <= ${cutoff}::timestamptz and expires_at > ${lastSeenAt.toISOString()}::timestamptz and created_at > ${new Date(lastSeenAt.getTime() - SESSION_ABSOLUTE_TTL_MS).toISOString()}::timestamptz`;
  }

  async revoke(id: string): Promise<void> {
    await this.database()`delete from sessions where id = ${id}`;
  }
}
