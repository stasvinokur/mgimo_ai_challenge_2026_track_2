import { expect, test } from "@playwright/test";
import { CryptoSessionTokens } from "../../src/infrastructure/auth/session-tokens";
import { createDatabase } from "../../src/infrastructure/db/client";
import { PostgresSessionStore } from "../../src/infrastructure/db/repositories/identity/sessions";
import { PostgresIdentityRepository } from "../../src/infrastructure/db/repositories/identity/users";
import { UuidV7Generator } from "../../src/infrastructure/system/id-generator";

test("HTTP: неизвестные статические пути получают CSP и no-store", async ({
  request,
}) => {
  for (const path of [
    "/icons/xyz",
    "/icons/icon-192.png/extra",
    "/favicon.svg/xyz",
    "/pulse.svg-extra",
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(404);
    expect(
      response
        .headers()
        ["cache-control"]?.split(",")
        .map((part) => part.trim()),
    ).toContain("no-store");
    expect(response.headers()["content-security-policy"]).toContain("'nonce-");
    expect(response.headers()["permissions-policy"]).toBe(
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    );
  }
});

test("HTTP: аноним получает 307/303 до отправки HTML", async ({ request }) => {
  for (const path of ["/today", "/profile", "/staff/requests"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect([307, 303]).toContain(response.status());
    const location = response.headers().location;
    expect(location).toBeTruthy();
    expect(new URL(location ?? "", response.url()).pathname).toBe("/login");
    expect(await response.text()).not.toMatch(
      /<(?:!doctype|html|head|body)\b/i,
    );
  }
});

test("HTTP: студент на staff получает статус 403 до стриминга", async ({
  request,
}) => {
  test.skip(
    !process.env.DATABASE_URL,
    "DATABASE_URL не задан: HTTP-проверка студенческой сессии пропущена.",
  );
  const sql = createDatabase(1);
  const sessions = new PostgresSessionStore(() => sql);
  const id = new UuidV7Generator().next();
  try {
    const user = await new PostgresIdentityRepository(
      () => sql,
    ).findCredentials("anna");
    if (!user)
      throw new Error("Нет демо-аккаунта Анны: выполните сид тестовой БД.");
    const tokens = new CryptoSessionTokens();
    const token = tokens.generate();
    const now = new Date();
    await sessions.create({
      id,
      userId: user.userId,
      tokenHash: tokens.hash(token),
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
    });
    for (const path of ["/staff", "/staff/requests", "/staff/profile"]) {
      const response = await request.get(path, {
        headers: { cookie: `__Host-pulse-session=${token}` },
        maxRedirects: 0,
      });
      expect(
        response.status(),
        `${path}: нужен HTTP 403, текста отказа при HTTP 200 недостаточно`,
      ).toBe(403);
    }
    const tree = [
      "",
      {
        children: [
          "(staff)",
          {
            children: [
              "staff",
              {
                children: [
                  "requests",
                  { children: ["__PAGE__", {}, null, "refetch"] },
                ],
              },
            ],
          },
        ],
      },
    ];
    const flightHeaders = {
      cookie: `__Host-pulse-session=${token}`,
      RSC: "1",
      "Next-Router-State-Tree": encodeURIComponent(JSON.stringify(tree)),
    };
    async function getFlight(url: string) {
      try {
        return await request.get(url, {
          headers: flightHeaders,
          maxRedirects: 0,
        });
      } catch {
        // Playwright's raw request errors include the cookie in their call log.
        throw new Error("Не удалось выполнить HTTP-проверку RSC.");
      }
    }
    let flight = await getFlight("/staff/requests");
    if (flight.status() === 307) {
      // Follow Next's cache-key redirect manually: APIRequest drops raw cookies.
      const destination = new URL(
        flight.headers().location ?? "",
        flight.url(),
      );
      expect(destination.pathname).toBe("/staff/requests");
      expect(destination.searchParams.has("_rsc")).toBe(true);
      flight = await getFlight(destination.toString());
    }
    const payload = await flight.text();
    expect(
      flight.status() === 403 ||
        payload.includes("NEXT_HTTP_ERROR_FALLBACK;403"),
      `RSC: статус ${flight.status()}, тип ${flight.headers()["content-type"]}, байтов ${payload.length}, digest ${payload.match(/"digest":"([a-zA-Z0-9_;-]+)"/)?.[1] ?? "нет"}`,
    ).toBe(true);
    expect(payload).not.toContain("Очередь заявок ещё не подключена");
    expect(payload).not.toContain("Мой профиль");
  } finally {
    await sessions.revoke(id);
    await sql.end({ timeout: 1 });
  }
});
