import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type {
  PasskeyAuthenticationOptions,
  PasskeyRegistrationOptions,
} from "@/application/ports/passkey-verifier";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { openStudentTestData } from "../integration/student-e2e-data";
import {
  authenticationResponse,
  browserJson,
  expect,
  type PasskeyDTO,
  passkeyOrigin,
  registerKey,
  registrationResponse,
  test,
} from "./passkey-fixture";
import { loginAsTestStudent } from "./student-login";

test("IDOR: Анна не видит ключ Тимура в списке, прямые GET и DELETE дают тот же 404, что отсутствующий ключ", async ({
  page,
  passkeyAccount: anna,
  authenticator,
}) => {
  expect(authenticator.id).toBeTruthy();
  const timur = await openStudentTestData("timur");
  try {
    await loginAsTestStudent(page, timur.credentials);
    await page.goto("/profile");
    const key = await registerKey(page, "Учебный телефон Тимура");
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await anna.login(page);
    const list = await browserJson<{ credentials: PasskeyDTO[] }>(
      page,
      `/api/passkeys?userId=${timur.actor.userId}&studentId=${timur.actor.studentId}`,
    );
    expect(list).toEqual({
      status: 200,
      body: { credentials: [], isDemoAccount: false },
    });
    for (const method of ["GET", "DELETE"]) {
      const foreign = await browserJson(
        page,
        `/api/passkeys/${key.id}`,
        method,
      );
      const missing = await browserJson(
        page,
        `/api/passkeys/${randomUUID()}`,
        method,
      );
      expect(foreign.status).toBe(404);
      expect(missing).toEqual(foreign);
    }
    const [remaining] = await anna.sql<{ n: number }[]>`
      select count(*)::int as n from passkey_credentials
      where id = ${key.id} and user_id = ${timur.actor.userId}`;
    expect(remaining?.n).toBe(1);
  } finally {
    await timur.close();
  }
});

test("реальная подпись создаёт сессию с отзывом предыдущей; повтор challenge с новой подписью отвергается", async ({
  page,
  context,
  passkeyAccount: account,
  authenticator,
}) => {
  expect(authenticator.id).toBeTruthy();
  await account.login(page);
  await page.goto(account.profile);
  const key = await registerKey(page, "Телефон для проверки сессии");
  const previousCookie = (await context.cookies()).find(
    (cookie) => cookie.name === "__Host-pulse-session",
  );
  if (!previousCookie) throw new Error("Не создана сессия входа по паролю.");
  const options = await browserJson<PasskeyAuthenticationOptions>(
    page,
    "/api/passkeys/authentication/options",
    "POST",
    {},
  );
  expect(options.status).toBe(200);
  expect(options.body.rpId).toBe("localhost");
  expect(options.body.userVerification).toBe("required");
  const challengeCookie = (await context.cookies()).find(
    (cookie) => cookie.name === "__Host-passkey-authentication",
  );
  if (!challengeCookie) throw new Error("Не создана cookie challenge.");
  expect({
    httpOnly: challengeCookie.httpOnly,
    secure: challengeCookie.secure,
    sameSite: challengeCookie.sameSite,
    path: challengeCookie.path,
  }).toEqual({ httpOnly: true, secure: true, sameSite: "Strict", path: "/" });
  expect(challengeCookie.expires - Date.now() / 1000).toBeLessThanOrEqual(300);
  const [stored] = await account.sql<
    {
      challengeHash: string;
      lifetime: number;
    }[]
  >`
    select challenge_hash as "challengeHash",
      extract(epoch from expires_at - created_at)::int as lifetime
    from webauthn_challenges where id = ${challengeCookie.value}`;
  expect(stored?.lifetime).toBeGreaterThan(0);
  expect(stored?.lifetime).toBeLessThanOrEqual(300);
  expect(stored?.challengeHash).toMatch(/^[a-f0-9]{64}$/);
  expect(stored?.challengeHash === options.body.challenge).toBe(false);

  const response = await authenticationResponse(page, options.body);
  const success = await browserJson(
    page,
    "/api/passkeys/authentication/verify",
    "POST",
    {
      response,
      next: "https://other.example.invalid/",
    },
  );
  expect(success).toEqual({ status: 200, body: { destination: account.home } });
  const currentCookie = (await context.cookies()).find(
    (cookie) => cookie.name === "__Host-pulse-session",
  );
  expect(Boolean(currentCookie)).toBe(true);
  expect(currentCookie?.value === previousCookie.value).toBe(false);
  expect({
    httpOnly: currentCookie?.httpOnly,
    secure: currentCookie?.secure,
    sameSite: currentCookie?.sameSite,
    path: currentCookie?.path,
  }).toEqual({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
  const oldHash = new CryptoSessionTokens().hash(previousCookie.value);
  expect(
    await account.sql`select id from sessions where token_hash = ${oldHash}`,
  ).toHaveLength(0);
  const [first] = await account.sql<{ counter: number; lastUsedAt: Date }[]>`
    select counter, last_used_at as "lastUsedAt" from passkey_credentials where id = ${key.id}`;
  expect(Number(first?.counter)).toBeGreaterThan(0);
  expect(first?.lastUsedAt).toBeInstanceOf(Date);
  const [challenge] = await account.sql<{ used: boolean }[]>`
    select used_at is not null as used from webauthn_challenges where id = ${challengeCookie.value}`;
  expect(challenge?.used).toBe(true);

  // A fresh valid signature advances the device counter; only the used challenge is stale.
  const repeated = await authenticationResponse(page, options.body);
  expect(
    Buffer.from(repeated.response.authenticatorData, "base64url").readUInt32BE(
      33,
    ),
  ).toBeGreaterThan(Number(first?.counter));
  await context.addCookies([challengeCookie]);
  const replay = await browserJson(
    page,
    "/api/passkeys/authentication/verify",
    "POST",
    { response: repeated },
  );
  const invalid = await browserJson(
    page,
    "/api/passkeys/authentication/verify",
    "POST",
    {},
  );
  expect(replay.status).toBe(400);
  expect(replay).toEqual(invalid);
  const [afterReplay] = await account.sql<{ counter: number; n: number }[]>`
    select counter, (select count(*)::int from sessions where user_id = ${account.actor.userId}) as n
    from passkey_credentials where id = ${key.id}`;
  expect(Number(afterReplay?.counter)).toBe(Number(first?.counter));
  expect(afterReplay?.n).toBe(1);
});

for (const failure of ["expired", "counter"] as const) {
  test(`одинаковая ошибка входа: ${failure}, сессия и ключ не изменены`, async ({
    page,
    context,
    passkeyAccount: account,
    authenticator,
  }) => {
    expect(authenticator.id).toBeTruthy();
    await account.login(page);
    await page.goto(account.profile);
    const key = await registerKey(page, "Телефон для проверки отказа");
    const [baseline] = await account.sql<
      { counter: number; lastUsedAt: Date | null }[]
    >`
      select counter, last_used_at as "lastUsedAt" from passkey_credentials where id = ${key.id}`;
    if (!baseline) throw new Error("Не сохранён ключ доступа.");
    const expectedCounter =
      Number(baseline.counter) + (failure === "counter" ? 10 : 0);
    const previousCookie = (await context.cookies()).find(
      (cookie) => cookie.name === "__Host-pulse-session",
    );
    const options = await browserJson<PasskeyAuthenticationOptions>(
      page,
      "/api/passkeys/authentication/options",
      "POST",
      {},
    );
    expect(options.status).toBe(200);
    if (failure === "counter")
      await account.sql`update passkey_credentials set counter = ${expectedCounter} where id = ${key.id}`;
    if (failure === "expired") {
      const cookie = (await context.cookies()).find(
        (item) => item.name === "__Host-passkey-authentication",
      );
      if (!cookie) throw new Error("Не создан challenge.");
      await account.sql`update webauthn_challenges
        set created_at = now() - interval '6 minutes', expires_at = now() - interval '1 minute'
        where id = ${cookie.value}`;
    }
    const response = await authenticationResponse(page, options.body);
    const rejected = await browserJson(
      page,
      "/api/passkeys/authentication/verify",
      "POST",
      { response },
    );
    const invalid = await browserJson(
      page,
      "/api/passkeys/authentication/verify",
      "POST",
      {},
    );
    expect(rejected.status).toBe(400);
    expect(rejected).toEqual(invalid);
    const currentCookie = (await context.cookies()).find(
      (cookie) => cookie.name === "__Host-pulse-session",
    );
    expect(currentCookie?.value === previousCookie?.value).toBe(true);
    const [credential] = await account.sql<
      { counter: number; lastUsedAt: Date | null }[]
    >`
      select counter, last_used_at as "lastUsedAt" from passkey_credentials where id = ${key.id}`;
    expect(Number(credential?.counter)).toBe(expectedCounter);
    expect(credential?.lastUsedAt).toEqual(baseline.lastUsedAt);
  });
}

for (const role of ["student", "staff"] as const) {
  test.describe(`свежесть сессии регистрации · ${role}`, () => {
    test.use({ passkeyRole: role });

    test("старая сессия не выдаёт challenge и не сохраняет ключ; карточка предлагает войти заново", async ({
      page,
      context,
      passkeyAccount: account,
      authenticator,
    }) => {
      expect(authenticator.id).toBeTruthy();
      await account.login(page);
      await page.goto(account.profile);
      const options = await browserJson<PasskeyRegistrationOptions>(
        page,
        "/api/passkeys/registration/options",
        "POST",
        {},
      );
      expect(options.status).toBe(200);
      const response = await registrationResponse(page, options.body);
      const session = (await context.cookies()).find(
        (cookie) => cookie.name === "__Host-pulse-session",
      );
      if (!session) throw new Error("Не создана сессия.");
      const hash = new CryptoSessionTokens().hash(session.value);
      await account.sql`update sessions set created_at = now() - interval '11 minutes'
        where token_hash = ${hash}`;
      const before = await account.sql<{ id: string; usedAt: Date | null }[]>`
        select id, used_at as "usedAt" from webauthn_challenges
        where user_id = ${account.actor.userId} order by id`;
      const verification = await browserJson(
        page,
        "/api/passkeys/registration/verify",
        "POST",
        {
          deviceName: "Ключ из старой сессии",
          response,
        },
      );
      const issuance = await browserJson(
        page,
        "/api/passkeys/registration/options",
        "POST",
        {},
      );
      const denied = {
        status: 403,
        body: {
          error: {
            code: "PASSKEY_REAUTHENTICATION_REQUIRED",
            message: "Чтобы добавить ключ доступа, войдите заново",
          },
        },
      };
      expect(verification).toEqual(denied);
      expect(issuance).toEqual(denied);
      expect(
        await account.sql`select id from passkey_credentials where user_id = ${account.actor.userId}`,
      ).toHaveLength(0);
      const after = await account.sql<{ id: string; usedAt: Date | null }[]>`
        select id, used_at as "usedAt" from webauthn_challenges
        where user_id = ${account.actor.userId} order by id`;
      expect(after).toEqual(before);

      const card = page.getByRole("region", {
        name: "Ключи доступа",
        exact: true,
      });
      await card
        .getByLabel("Название устройства", { exact: true })
        .fill("Мой телефон");
      await card
        .getByRole("button", { name: "Добавить ключ", exact: true })
        .click();
      await expect(card.getByRole("alert")).toContainText(
        "Чтобы добавить ключ доступа, войдите заново",
      );
      const login = card.getByRole("link", {
        name: "Войти заново",
        exact: true,
      });
      await expect(login).toHaveAttribute(
        "href",
        `/login?next=${encodeURIComponent(account.profile)}`,
      );
      await login.click();
      await expect(page).toHaveURL(
        new RegExp(`/login\\?next=${encodeURIComponent(account.profile)}$`),
      );
    });

    test("после отказа старой сессии удаление ключа сохраняет подсказку и ссылку повторного входа", async ({
      page,
      context,
      passkeyAccount: account,
      authenticator,
    }) => {
      expect(authenticator.id).toBeTruthy();
      await account.login(page);
      await page.goto(account.profile);
      const deviceName = "Прежний учебный телефон";
      await registerKey(page, deviceName);
      const session = (await context.cookies()).find(
        (cookie) => cookie.name === "__Host-pulse-session",
      );
      if (!session) throw new Error("Не создана сессия.");
      const hash = new CryptoSessionTokens().hash(session.value);
      await account.sql`update sessions set created_at = now() - interval '11 minutes'
        where token_hash = ${hash}`;
      const card = page.getByRole("region", {
        name: "Ключи доступа",
        exact: true,
      });
      await card
        .getByLabel("Название устройства", { exact: true })
        .fill("Новый телефон");
      await card
        .getByRole("button", { name: "Добавить ключ", exact: true })
        .click();
      const login = card.getByRole("link", {
        name: "Войти заново",
        exact: true,
      });
      await expect(login).toBeVisible();
      const row = card.getByRole("listitem").filter({ hasText: deviceName });
      const notice = card
        .getByRole("status")
        .filter({ hasText: "Ключ доступа удалён." });
      const hint = card.getByText(
        "Чтобы добавить ключ доступа, войдите заново",
        { exact: true },
      );
      let refreshRequested = false;
      let releaseRefresh = () => {};
      const heldRefresh = new Promise<void>((resolve) => {
        releaseRefresh = resolve;
      });
      const refreshRoute = "**/api/passkeys";
      await page.route(refreshRoute, async (route) => {
        if (route.request().method() === "GET") {
          refreshRequested = true;
          await heldRefresh;
        }
        await route.continue();
      });
      try {
        await row.getByRole("button", { name: /^Удалить/ }).click();
        await expect.poll(() => refreshRequested).toBe(true);
        await expect(row).toBeVisible();
        await expect(card.getByRole("list")).toHaveAttribute(
          "aria-busy",
          "true",
        );
        await expect(card.getByRole("status")).toHaveCount(1);
        await expect(notice).toBeVisible();
        await expect(login).toBeVisible();
        await expect(hint).toHaveCount(1);

        releaseRefresh();
        await expect(row).toHaveCount(0);
        await expect(
          card.getByText(/^Ключей доступа пока нет\./),
        ).toHaveAttribute("aria-busy", "false");
        await expect(card.getByRole("status")).toHaveCount(1);
        await expect(notice).toBeVisible();
        await expect(login).toBeVisible();
        await expect(login).toHaveAttribute(
          "href",
          `/login?next=${encodeURIComponent(account.profile)}`,
        );
        await expect(hint).toHaveCount(1);
        await expect(
          card.getByRole("button", { name: "Добавить ключ", exact: true }),
        ).toBeDisabled();
      } finally {
        releaseRefresh();
        await page.unroute(refreshRoute);
      }
    });
  });
}

test("чужой и отсутствующий Origin не создают challenge, не добавляют и не удаляют ключ", async ({
  page,
  passkeyAccount: account,
  authenticator,
}) => {
  expect(authenticator.id).toBeTruthy();
  await account.login(page);
  await page.goto(account.profile);
  const key = await registerKey(page, "Телефон для проверки Origin");
  for (const origin of [undefined, "null", "https://other.example.invalid"]) {
    for (const path of [
      "/api/passkeys/registration/options",
      "/api/passkeys/registration/verify",
    ]) {
      const denied = await rawJson(page, path, "POST", origin, {});
      expect(denied.status).toBe(403);
    }
    const deletion = await rawJson(
      page,
      `/api/passkeys/${key.id}`,
      "DELETE",
      origin,
    );
    expect(deletion.status).toBe(403);
    const options = await rawJson(
      page,
      "/api/passkeys/authentication/options",
      "POST",
      origin,
      {},
    );
    const verification = await rawJson(
      page,
      "/api/passkeys/authentication/verify",
      "POST",
      origin,
      {},
    );
    expect(options.status).toBe(400);
    expect(options).toEqual(verification);
  }
  const list = await browserJson<{ credentials: PasskeyDTO[] }>(
    page,
    "/api/passkeys",
  );
  expect(list.body.credentials).toHaveLength(1);
  const [challenges] = await account.sql<{ n: number }[]>`
    select count(*)::int as n from webauthn_challenges
    where user_id = ${account.actor.userId} and used_at is null`;
  expect(challenges?.n).toBe(0);
  const crossSite = await rawJson(
    page,
    "/api/passkeys/authentication/options",
    "POST",
    passkeyOrigin,
    {},
    "cross-site",
  );
  expect(crossSite.status).toBe(400);
});

async function rawJson(
  page: Page,
  path: string,
  method: string,
  origin: string | undefined,
  data?: unknown,
  fetchSite = "same-origin",
) {
  try {
    const response = await page.request.fetch(path, {
      method,
      data,
      headers: {
        ...(origin === undefined ? {} : { Origin: origin }),
        "Sec-Fetch-Site": fetchSite,
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
      },
      maxRedirects: 0,
    });
    return { status: response.status(), body: await response.json() };
  } catch {
    // Raw Playwright request errors can include authentication headers.
    throw new Error("Не удалось выполнить HTTP-проверку ключей доступа.");
  }
}
