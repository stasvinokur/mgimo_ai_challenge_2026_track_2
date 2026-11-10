import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { createDatabase } from "@/infrastructure/db/client";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { cleanupIdentity } from "../../scripts/cleanup-identity";

it.skipIf(!process.env.DATABASE_URL)(
  "cleanup удаляет использованные и просроченные challenges, сохраняя действующий неиспользованный",
  async () => {
    const sql = createDatabase(1);
    const ids = Array.from({ length: 4 }, () => new UuidV7Generator().next());
    const now = new Date();
    try {
      for (const [index, id] of ids.entries()) {
        const createdAt = new Date(now.getTime() - 300_000);
        const expiresAt = new Date(
          now.getTime() + (index === 1 || index === 2 ? 0 : 240_000),
        );
        // The live rows start now so every fixture satisfies the five-minute TTL.
        if (index === 0 || index === 3) createdAt.setTime(now.getTime());
        const usedAt = index === 0 || index === 2 ? now.toISOString() : null;
        await sql`
          insert into webauthn_challenges
            (id, purpose, challenge_hash, created_at, expires_at, used_at)
          values (${id}, 'authentication', ${createHash("sha256").update(id).digest("hex")},
            ${createdAt.toISOString()}::timestamptz, ${expiresAt.toISOString()}::timestamptz,
            ${usedAt}::timestamptz)`;
      }
      await cleanupIdentity(sql, now);
      for (const [index, id] of ids.entries()) {
        expect(
          await sql`select id from webauthn_challenges where id = ${id}`,
        ).toHaveLength(index === 3 ? 1 : 0);
      }
    } finally {
      for (const id of ids)
        await sql`delete from webauthn_challenges where id = ${id}`;
      await sql.end({ timeout: 1 });
    }
  },
);
