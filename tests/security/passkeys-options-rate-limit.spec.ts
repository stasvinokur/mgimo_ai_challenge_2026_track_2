import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import {
  PASSKEY_AUTHENTICATION_ISSUANCE_LIMIT,
  PASSKEY_REGISTRATION_ISSUANCE_LIMIT,
} from "@/domain/identity/passkey-policy";
import { getClientIp } from "@/infrastructure/auth/request-ip";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { createDatabase } from "@/infrastructure/db/client";
import { identityMessages } from "@/ui/i18n/dictionaries/identity";
import { t } from "@/ui/i18n/translate";
import {
  expect,
  type PasskeyAccount,
  passkeyOrigin,
  test,
} from "./passkey-fixture";

function uniqueIp() {
  const suffix = randomUUID().replaceAll("-", "");
  return `2001:db8:${suffix.slice(0, 4)}:${suffix.slice(4, 8)}::1`;
}

async function createSession(account: PasskeyAccount) {
  const tokens = new CryptoSessionTokens();
  const token = tokens.generate();
  await account.sql`
    insert into sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at)
    values (${randomUUID()}, ${account.actor.userId}, ${tokens.hash(token)},
      now(), now(), now() + interval '1 hour')`;
  return token;
}

async function issue(
  request: APIRequestContext,
  purpose: "authentication" | "registration",
  ip: string,
  challengeIds: Set<string>,
  sessionToken?: string,
) {
  try {
    const response = await request.post(
      `${passkeyOrigin}/api/passkeys/${purpose}/options`,
      {
        data: {},
        headers: {
          Origin: passkeyOrigin,
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Dest": "empty",
          "X-Forwarded-For": ip,
          ...(sessionToken
            ? { Cookie: `__Host-pulse-session=${sessionToken}` }
            : {}),
        },
        maxRedirects: 0,
      },
    );
    const cookie = response.headers()["set-cookie"] ?? "";
    const challengeId = cookie.match(
      new RegExp(`__Host-passkey-${purpose}=([0-9a-f-]{36})(?:;|$)`),
    )?.[1];
    if (challengeId) challengeIds.add(challengeId);
    const status = response.status();
    await response.dispose();
    return { status, challengeId };
  } catch {
    // Request failures may include the session header in Playwright's message.
    throw new Error("Не удалось выполнить HTTP-проверку квоты challenge.");
  }
}

test("поток из 1000 POST одного IP ограничивает challenge и оставляет доступ другому IP", async ({
  request,
}) => {
  test.skip(!process.env.DATABASE_URL, "Нужна тестовая БД лейна.");
  test.setTimeout(120_000);
  const sql = createDatabase(1);
  const tokens = new CryptoSessionTokens();
  const ip = uniqueIp();
  const otherIp = uniqueIp();
  const challengeIds = new Set<string>();
  const keys = [ip, otherIp].flatMap((address) => {
    const hash = tokens.hash(getClientIp(address));
    return [
      `passkey-challenge:authentication:ip:${hash}`,
      `passkey-options:ip:${hash}`,
      `ip:${hash}`,
    ];
  });
  try {
    for (
      let index = 0;
      index < PASSKEY_AUTHENTICATION_ISSUANCE_LIMIT;
      index++
    ) {
      const result = await issue(request, "authentication", ip, challengeIds);
      expect(result.status).toBe(200);
      expect(result.challengeId).toBeTruthy();
    }
    for (let index = 0; index < 10; index++)
      expect(await issue(request, "authentication", ip, challengeIds)).toEqual({
        status: 400,
        challengeId: undefined,
      });
    const [count] = await sql<{ n: number }[]>`
      select count(*)::int as n from webauthn_challenges
      where id = any(${[...challengeIds]}::uuid[])`;
    expect(count?.n).toBe(PASSKEY_AUTHENTICATION_ISSUANCE_LIMIT);
    expect(challengeIds.size).toBe(PASSKEY_AUTHENTICATION_ISSUANCE_LIMIT);
    const [issuance] = await sql<{ n: number }[]>`
      select count(*)::int as n from login_attempts
      where key = ${`passkey-challenge:authentication:ip:${tokens.hash(getClientIp(ip))}`}`;
    expect(issuance?.n).toBe(PASSKEY_AUTHENTICATION_ISSUANCE_LIMIT);
    const [attempts] = await sql<{ n: number }[]>`
      select count(*)::int as n from login_attempts
      where key = ${`ip:${tokens.hash(getClientIp(ip))}`}`;
    expect(attempts?.n).toBe(0);
    expect(
      (await issue(request, "authentication", otherIp, challengeIds)).status,
    ).toBe(200);
  } finally {
    try {
      await sql`delete from webauthn_challenges where id = any(${[...challengeIds]}::uuid[])`;
      await sql`delete from login_attempts where key = any(${keys}::text[])`;
    } finally {
      await sql.end({ timeout: 1 });
    }
  }
});

for (const purpose of ["authentication", "registration"] as const) {
  test(`12 одновременных HTTP-выдач ${purpose} не обходят последние три места`, async ({
    request,
    passkeyAccount: account,
  }) => {
    const tokens = new CryptoSessionTokens();
    const ip = uniqueIp();
    const ipHash = tokens.hash(getClientIp(ip));
    const userHash = tokens.hash(account.actor.userId);
    const issuanceKey =
      purpose === "authentication"
        ? `passkey-challenge:authentication:ip:${ipHash}`
        : `passkey-challenge:registration:user:${userHash}`;
    const limit =
      purpose === "authentication"
        ? PASSKEY_AUTHENTICATION_ISSUANCE_LIMIT
        : PASSKEY_REGISTRATION_ISSUANCE_LIMIT;
    const keys = [
      issuanceKey,
      `passkey-options:ip:${ipHash}`,
      `passkey-registration-options:user:${userHash}`,
      `ip:${ipHash}`,
    ];
    const challengeIds = new Set<string>();
    try {
      const sessionToken = await createSession(account);
      await account.sql`
        insert into login_attempts (id, key, at)
        select gen_random_uuid(), ${issuanceKey}, now()
        from generate_series(1, ${limit - 3})`;
      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          issue(request, purpose, ip, challengeIds, sessionToken),
        ),
      );
      expect(results.filter((result) => result.status === 200)).toHaveLength(3);
      expect(results.filter((result) => result.status === 400)).toHaveLength(9);
      for (const result of results)
        expect(Boolean(result.challengeId)).toBe(result.status === 200);
      const [count] = await account.sql<{ n: number }[]>`
        select count(*)::int as n from webauthn_challenges
        where id = any(${[...challengeIds]}::uuid[])`;
      expect(count?.n).toBe(3);
      const [attempts] = await account.sql<{ n: number }[]>`
        select count(*)::int as n from login_attempts where key = ${issuanceKey}`;
      expect(attempts?.n).toBe(limit);
      const [failures] = await account.sql<{ n: number }[]>`
        select count(*)::int as n from login_attempts where key = ${`ip:${ipHash}`}`;
      expect(failures?.n).toBe(0);
    } finally {
      await account.sql`delete from webauthn_challenges where id = any(${[...challengeIds]}::uuid[])`;
      await account.sql`delete from login_attempts where key = any(${keys}::text[])`;
    }
  });
}

test.describe("прямое удаление демо-ключа через HTTP", () => {
  test.use({ passkeyDemoAccount: true });

  test("демо получает одинаковый 404 без удаления, обычный владелец удаляет свой ключ", async ({
    request,
    passkeyAccount: account,
  }) => {
    const keyId = randomUUID();
    const sessionToken = await createSession(account);
    const [owner] = await account.sql<{ seedKey: string | null }[]>`
      select seed_key as "seedKey" from users where id = ${account.actor.userId}`;
    expect(owner?.seedKey).toBe(`passkey-test:${account.actor.userId}`);
    for (const language of ["ru", "en"] as const) {
      const result = await (async () => {
        try {
          const response = await request.get(
            `${passkeyOrigin}${account.profile}`,
            {
              headers: {
                Cookie: `__Host-pulse-session=${sessionToken}; pulse-language=${language}`,
              },
              maxRedirects: 0,
            },
          );
          const result = {
            status: response.status(),
            html: await response.text(),
          };
          await response.dispose();
          return result;
        } catch {
          throw new Error("Не удалось выполнить HTTP-проверку профиля.");
        }
      })();
      expect(result.status).toBe(200);
      expect(result.html).toMatch(new RegExp(`<html[^>]*lang="${language}"`));
      expect(result.html).toContain(
        t(language, identityMessages, "passkeysTitle"),
      );
    }
    await account.sql`
      insert into passkey_credentials
        (id, user_id, credential_id, public_key, counter, transports, device_name, created_at)
      values (${keyId}, ${account.actor.userId}, ${randomUUID()}, 'dGVzdA', 0,
        '{}'::text[], 'Ключ демо-аккаунта', now())`;
    async function remove(id: string) {
      try {
        const response = await request.delete(
          `${passkeyOrigin}/api/passkeys/${id}`,
          {
            headers: {
              Origin: passkeyOrigin,
              "Sec-Fetch-Site": "same-origin",
              "Sec-Fetch-Mode": "cors",
              "Sec-Fetch-Dest": "empty",
              Cookie: `__Host-pulse-session=${sessionToken}`,
            },
            maxRedirects: 0,
          },
        );
        const result = {
          status: response.status(),
          body: await response.json(),
        };
        await response.dispose();
        return result;
      } catch {
        throw new Error("Не удалось выполнить HTTP-проверку удаления ключа.");
      }
    }
    const denied = await remove(keyId);
    expect(denied.status).toBe(404);
    expect(denied.body).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect(await remove(randomUUID())).toEqual(denied);
    const [preserved] = await account.sql<{ id: string }[]>`
      select id from passkey_credentials
      where id = ${keyId} and user_id = ${account.actor.userId}`;
    expect(preserved).toEqual({ id: keyId });
    // Only this temporary account changes category to verify ordinary deletion.
    await account.sql`update users set seed_key = null where id = ${account.actor.userId}`;
    expect(await remove(keyId)).toEqual({ status: 200, body: { ok: true } });
    const [removed] = await account.sql<{ n: number }[]>`
      select count(*)::int as n from passkey_credentials
      where id = ${keyId} and user_id = ${account.actor.userId}`;
    expect(removed?.n).toBe(0);
  });
});
