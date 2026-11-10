import type { Sql } from "postgres";
import type {
  PasskeyRecord,
  PasskeyRepository,
  WebauthnChallenge,
} from "@/application/identity/passkey-ports";
import { PASSKEY_CREDENTIAL_LIMIT } from "@/domain/identity/passkey-policy";

interface PasskeyRow extends Omit<PasskeyRecord, "createdAt" | "lastUsedAt"> {
  createdAt: Date;
  lastUsedAt: Date | null;
}

function toRecord(row: PasskeyRow): PasskeyRecord {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

export class PostgresPasskeyRepository implements PasskeyRepository {
  constructor(private readonly database: () => Sql) {}

  async listForUser(userId: string): Promise<PasskeyRecord[]> {
    const rows = await this.database()<PasskeyRow[]>`
      select id, user_id as "userId", credential_id as "credentialId",
        public_key as "publicKey", counter::double precision as counter,
        transports, device_name as "deviceName", created_at as "createdAt",
        last_used_at as "lastUsedAt"
      from passkey_credentials where user_id = ${userId}
      order by created_at desc, id desc`;
    return rows.map(toRecord);
  }

  async findLoginForUser(userId: string): Promise<string | null> {
    const [row] = await this.database()<{ login: string }[]>`
      select login from users where id = ${userId}`;
    return row?.login ?? null;
  }

  async isDemoAccount(userId: string): Promise<boolean> {
    const [row] = await this.database()<{ isDemoAccount: boolean }[]>`
      select seed_key is not null as "isDemoAccount" from users where id = ${userId}`;
    return row?.isDemoAccount ?? false;
  }

  async create(record: PasskeyRecord): Promise<boolean> {
    const sql = this.database();
    return sql.begin(async (transaction) => {
      // Lock the owner row so concurrent registrations share the same cap.
      const [owner] = await transaction<{ isDemoAccount: boolean }[]>`
        select seed_key is not null as "isDemoAccount" from users
        where id = ${record.userId} for update`;
      const [row] = await transaction<{ count: number }[]>`
        select count(*)::int as count from passkey_credentials
        where user_id = ${record.userId}`;
      const count = row?.count ?? 0;
      if (count >= PASSKEY_CREDENTIAL_LIMIT) {
        if (!owner?.isDemoAccount) return false;
        await transaction`
          delete from passkey_credentials
          where user_id = ${record.userId} and id in (
            select id from passkey_credentials where user_id = ${record.userId}
            order by created_at asc, id asc
            limit ${count - PASSKEY_CREDENTIAL_LIMIT + 1}
          )`;
      }
      await transaction`
        insert into passkey_credentials
          (id, user_id, credential_id, public_key, counter, transports, device_name, created_at, last_used_at)
        values (${record.id}, ${record.userId}, ${record.credentialId}, ${record.publicKey},
          ${record.counter}, ${record.transports}::text[], ${record.deviceName},
          ${record.createdAt}::timestamptz, ${record.lastUsedAt}::timestamptz)`;
      return true;
    });
  }

  async deleteForUser(id: string, userId: string): Promise<boolean> {
    const rows = await this.database()`
      delete from passkey_credentials where id = ${id} and user_id = ${userId}
        and exists (select 1 from users where id = ${userId} and seed_key is null)
      returning id`;
    return rows.length === 1;
  }

  async findByCredentialId(
    credentialId: string,
  ): Promise<PasskeyRecord | null> {
    const [row] = await this.database()<PasskeyRow[]>`
      select id, user_id as "userId", credential_id as "credentialId",
        public_key as "publicKey", counter::double precision as counter,
        transports, device_name as "deviceName", created_at as "createdAt",
        last_used_at as "lastUsedAt"
      from passkey_credentials where credential_id = ${credentialId}`;
    return row ? toRecord(row) : null;
  }

  async updateCounter(
    id: string,
    userId: string,
    previousCounter: number,
    newCounter: number,
    usedAt: Date,
  ): Promise<boolean> {
    // Compare-and-set rejects concurrent assertions read at the same counter.
    const rows = await this.database()`
      update passkey_credentials
      set counter = ${newCounter}, last_used_at = ${usedAt.toISOString()}::timestamptz
      where id = ${id} and user_id = ${userId} and counter = ${previousCounter}
        and (${newCounter} > counter or (counter = 0 and ${newCounter} = 0))
      returning id`;
    return rows.length === 1;
  }

  async createChallenge(challenge: WebauthnChallenge): Promise<void> {
    await this.database()`
      insert into webauthn_challenges
        (id, user_id, purpose, challenge_hash, created_at, expires_at)
      values (${challenge.id}, ${challenge.userId}, ${challenge.purpose},
        ${challenge.challengeHash}, ${challenge.createdAt}::timestamptz,
        ${challenge.expiresAt}::timestamptz)`;
  }

  async consumeChallenge(
    id: string,
    purpose: WebauthnChallenge["purpose"],
    userId: string | null,
    now: Date,
  ): Promise<WebauthnChallenge | null> {
    const [row] = await this.database()<
      (Omit<WebauthnChallenge, "createdAt" | "expiresAt"> & {
        createdAt: Date;
        expiresAt: Date;
      })[]
    >`
      update webauthn_challenges set used_at = ${now.toISOString()}::timestamptz
      where id = ${id} and purpose = ${purpose}
        and user_id is not distinct from ${userId}::uuid
        and used_at is null and expires_at > ${now.toISOString()}::timestamptz
        and created_at <= ${now.toISOString()}::timestamptz
      returning id, user_id as "userId", purpose, challenge_hash as "challengeHash",
        created_at as "createdAt", expires_at as "expiresAt"`;
    return row
      ? {
          ...row,
          createdAt: row.createdAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
        }
      : null;
  }
}
