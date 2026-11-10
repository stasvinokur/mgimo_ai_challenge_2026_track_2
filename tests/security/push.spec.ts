import { randomUUID } from "node:crypto";
import { createDatabase } from "@/infrastructure/db/client";
import { expect, test } from "./student-login";

const keys = { p256dh: `B${"a".repeat(86)}`, auth: "a".repeat(22) };
const operations = [
  { method: "GET", path: "/api/push" },
  { method: "POST", path: "/api/push/subscription" },
  { method: "DELETE", path: "/api/push/subscription" },
  { method: "POST", path: "/api/push/test" },
] as const;

test("push API возвращает анониму 401 без редиректа", async ({
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Укажите адрес приложения.");
  for (const operation of operations) {
    const response = await request.fetch(operation.path, {
      method: operation.method,
      headers: { Origin: new URL(baseURL).origin },
      ...(operation.method === "GET" ? {} : { data: {} }),
      maxRedirects: 0,
    });
    expect(response.status()).toBe(401);
    expect(response.headers().location).toBeUndefined();
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(await response.json()).toHaveProperty("error");
  }
});

for (const role of ["marina", "oleg"] as const) {
  test(`push API запрещён роли ${role === "marina" ? "сотрудник" : "преподаватель"}`, async ({
    page,
    loginAs,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Укажите адрес приложения.");
    await loginAs(role);
    for (const operation of operations) {
      const response = await page.request.fetch(operation.path, {
        method: operation.method,
        headers: { Origin: new URL(baseURL).origin },
        ...(operation.method === "GET" ? {} : { data: {} }),
        maxRedirects: 0,
      });
      expect(response.status()).toBe(403);
      expect(response.headers().location).toBeUndefined();
      expect(response.headers()["cache-control"]).toBe("private, no-store");
      expect(await response.json()).toHaveProperty("error");
    }
  });
}

test("подписки изолированы по сессии: чужую нельзя прочитать, удалить, проверить или присвоить", async ({
  page,
  students,
  loginAs,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Укажите адрес приложения.");
  const own = await students.get("anna");
  const foreign = await students.get("timur");
  const ownEndpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
  const foreignEndpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
  const sql = createDatabase(1);
  try {
    for (const [endpoint, userId] of [
      [ownEndpoint, own.actor.userId],
      [foreignEndpoint, foreign.actor.userId],
    ] as const) {
      await sql`insert into push_subscriptions (id, user_id, endpoint, p256dh, auth)
        values (${randomUUID()}, ${userId}, ${endpoint}, ${keys.p256dh}, ${keys.auth})`;
    }
    await loginAs("anna");
    const headers = {
      Origin: new URL(baseURL).origin,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
    };
    const configuration = await page.request.get(
      `/api/push?userId=${foreign.actor.userId}&studentId=${foreign.actor.studentId}`,
    );
    expect(configuration.status()).toBe(200);
    expect(configuration.headers()["cache-control"]).toBe("private, no-store");
    const config = await configuration.json();
    expect(Object.keys(config).sort()).toEqual(["endpoints", "publicKey"]);
    expect(config.endpoints).toContain(ownEndpoint);
    expect(config.endpoints).not.toContain(foreignEndpoint);
    expect(JSON.stringify(config)).not.toContain(keys.auth);

    for (const [method, path] of [
      ["DELETE", "/api/push/subscription"],
      ["POST", "/api/push/test"],
    ] as const) {
      const response = await page.request.fetch(path, {
        method,
        headers,
        data: { endpoint: foreignEndpoint },
      });
      expect(response.status()).toBe(404);
      expect(response.headers()["cache-control"]).toBe("private, no-store");
      expect(await response.text()).not.toContain(foreignEndpoint);
    }
    if (config.publicKey) {
      const takeover = await page.request.post("/api/push/subscription", {
        headers,
        data: { endpoint: foreignEndpoint, keys },
      });
      expect(takeover.status()).toBe(404);
      await takeover.body();
      for (let attempt = 0; attempt < 2; attempt++) {
        const duplicate = await page.request.post("/api/push/subscription", {
          headers,
          data: { endpoint: ownEndpoint, keys, expirationTime: null },
        });
        expect(duplicate.status()).toBe(200);
        await duplicate.body();
      }
      const rows =
        await sql`select id from push_subscriptions where endpoint = ${ownEndpoint}`;
      expect(rows).toHaveLength(1);
    }
    const forged = await page.request.delete("/api/push/subscription", {
      headers,
      data: { endpoint: foreignEndpoint, userId: foreign.actor.userId },
    });
    expect(forged.status()).toBe(400);
    await forged.body();
    const [unchanged] = await sql<
      { userId: string }[]
    >`select user_id as "userId" from push_subscriptions where endpoint = ${foreignEndpoint}`;
    expect(unchanged?.userId).toBe(foreign.actor.userId);
    const removed = await page.request.delete("/api/push/subscription", {
      headers,
      data: { endpoint: ownEndpoint },
    });
    expect(removed.status()).toBe(200);
    await removed.body();
    expect(
      await sql`select id from push_subscriptions where endpoint = ${ownEndpoint}`,
    ).toHaveLength(0);
  } finally {
    await sql.end({ timeout: 1 });
  }
});

test("Origin обязателен, подмена Host его не заменяет; мутации ограничены по частоте", async ({
  page,
  loginAs,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Укажите адрес приложения.");
  await loginAs("anna");
  const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
  for (const operation of operations.filter((item) => item.method !== "GET")) {
    for (const origin of [undefined, "null", "https://evil.example"]) {
      const response = await page.request.fetch(operation.path, {
        method: operation.method,
        headers: {
          ...(origin ? { Origin: origin } : {}),
          "X-Forwarded-Host": "evil.example",
          "X-Forwarded-Proto": "https",
          "Sec-Fetch-Site": "cross-site",
        },
        data: { endpoint, keys },
      });
      expect(response.status()).toBe(403);
      expect(response.headers()["cache-control"]).toBe("private, no-store");
      await response.body();
    }
  }
  for (let attempt = 0; attempt <= 30; attempt++) {
    const response = await page.request.delete("/api/push/subscription", {
      headers: {
        Origin: new URL(baseURL).origin,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
      },
      data: { endpoint },
    });
    expect(response.status()).toBe(attempt < 30 ? 404 : 429);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    await response.body();
  }
});

test("неканонический endpoint возвращает 400 без записи подписки", async ({
  page,
  students,
  loginAs,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Укажите адрес приложения.");
  const own = await students.get("anna");
  const path = `/fcm/send/${randomUUID()}`;
  const sql = createDatabase(1);
  try {
    await loginAs("anna");
    const before =
      await sql`select id from push_subscriptions where user_id = ${own.actor.userId}`;
    for (const endpoint of [
      `https:fcm.googleapis.com${path}`,
      `https:/fcm.googleapis.com${path}`,
      `https://fcm.googleapis.com:443${path}`,
      `https://FCM.googleapis.com${path}`,
      `HTTPS://fcm.googleapis.com${path}`,
    ]) {
      const response = await page.request.post("/api/push/subscription", {
        headers: {
          Origin: new URL(baseURL).origin,
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "cors",
        },
        data: { endpoint, keys },
      });
      expect(response.status()).toBe(400);
      expect(response.headers()["cache-control"]).toBe("private, no-store");
      await response.body();
    }
    const after =
      await sql`select id from push_subscriptions where user_id = ${own.actor.userId}`;
    expect(after).toEqual(before);
  } finally {
    await sql.end({ timeout: 1 });
  }
});
