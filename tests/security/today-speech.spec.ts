import { createHash } from "node:crypto";
import { SPEECH_PAIR_LIMIT } from "@/application/today/briefing-audio";
import { createDatabase } from "@/infrastructure/db/client";
import { openStaffFixture } from "../integration/staff-fixtures";
import { loginAsTestStaff } from "./staff-login";
import { expect, test } from "./student-login";
import { loginAsTestTeacher, openTeacherTestData } from "./teacher-login";

const checksum = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const path = `/api/me/briefing/0?checksum=${"0".repeat(64)}`;
function browserHeaders(baseURL: string | undefined) {
  if (!baseURL) throw new Error("Укажите адрес приложения.");
  return {
    Origin: new URL(baseURL).origin,
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
  };
}
function quotaKeys(userId: string, ips: string[]) {
  return [
    `briefing-speech:user:${checksum(userId)}`,
    ...ips.map((ip) => `briefing-speech:pair:${checksum(`${userId}\0${ip}`)}`),
  ];
}

test("озвучка без входа — 401, без редиректа и кэширования", async ({
  request,
  baseURL,
}) => {
  const response = await request.get(path, {
    maxRedirects: 0,
    headers: browserHeaders(baseURL),
  });
  expect(response.status()).toBe(401);
  expect(response.headers().location).toBeUndefined();
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
});
test("сотрудник и преподаватель получают 403 в самом route handler", async ({
  page,
  baseURL,
}) => {
  const staff = await openStaffFixture();
  const teacher = await openTeacherTestData();
  try {
    await loginAsTestStaff(page, staff.marinaCredentials);
    expect(
      (
        await page.request.get(path, { headers: browserHeaders(baseURL) })
      ).status(),
    ).toBe(403);
    await page.context().clearCookies();
    await loginAsTestTeacher(page, teacher.credentials);
    expect(
      (
        await page.request.get(path, { headers: browserHeaders(baseURL) })
      ).status(),
    ).toBe(403);
  } finally {
    await teacher.close();
    await staff.close();
  }
});
test("Анна с checksum фразы Тимура получает 409; клиент не задаёт текст или владельца", async ({
  page,
  loginAs,
  baseURL,
}) => {
  await loginAs("timur");
  const card = page.getByTestId("today-briefing");
  await expect(card).toHaveAttribute("data-briefing-ready", "true");
  await expect(card.getByTestId("briefing-phrase").first()).toBeVisible();
  const phrases = await card.getByTestId("briefing-phrase").allTextContents();
  expect(phrases.length).toBeGreaterThanOrEqual(3);
  expect(phrases.length).toBeLessThanOrEqual(5);
  const index = phrases.findIndex((phrase) =>
    phrase.includes("Основы маркетинга"),
  );
  expect(index).toBeGreaterThanOrEqual(0);
  const foreign = checksum(phrases[index] ?? "");
  await page.context().clearCookies();
  await loginAs("anna");
  const headers = browserHeaders(baseURL);
  const response = await page.request.get(
    `/api/me/briefing/${index}?checksum=${foreign}`,
    { headers },
  );
  expect(response.status()).toBe(409);
  expect(response.headers()["content-type"]).not.toBe("audio/wav");
  for (const extra of [
    "text=Чужой текст",
    "studentId=foreign",
    "userId=foreign",
    "voice=xenia",
  ])
    expect(
      (await page.request.get(`${path}&${extra}`, { headers })).status(),
    ).toBe(400);
  expect(
    (
      await page.request.get(`/api/me/briefing/99?checksum=${foreign}`, {
        headers,
      })
    ).status(),
  ).toBe(404);
});
test("общий демо-аккаунт: десять IP с повторами не закрывают голос следующему посетителю", async ({
  page,
  students,
  loginAs,
  baseURL,
}) => {
  const student = await students.get("anna");
  const sql = createDatabase(1);
  const ips = Array.from({ length: 11 }, (_, index) => `192.0.2.${57 + index}`);
  const keys = quotaKeys(student.actor.userId, ips);
  try {
    await sql`update users set seed_key=${`demo:tts-visitor:${student.actor.userId}`} where id=${student.actor.userId}`;
    await loginAs("anna");
    const card = page.getByTestId("today-briefing");
    await expect(card).toHaveAttribute("data-briefing-ready", "true");
    await expect(card.getByTestId("briefing-phrase").first()).toBeVisible();
    const phrases = await card.getByTestId("briefing-phrase").allTextContents();
    const index = phrases.findIndex((phrase) => phrase.startsWith("Главное:"));
    expect(index).toBeGreaterThanOrEqual(0);
    const ownPath = `/api/me/briefing/${index}?checksum=${checksum(phrases[index] ?? "")}`;
    const status = process.env.E2E_TTS === "1" ? 200 : 503;
    for (const ip of ips.slice(0, 10)) {
      const headers = { ...browserHeaders(baseURL), "X-Forwarded-For": ip };
      await Promise.all(
        Array.from({ length: SPEECH_PAIR_LIMIT }, async () => {
          const response = await page.request.get(ownPath, { headers });
          expect(response.status()).toBe(status);
          await response.dispose();
        }),
      );
      const response = await page.request.get(ownPath, { headers });
      expect(response.status()).toBe(429);
      await response.dispose();
    }
    const next = await page.request.get(ownPath, {
      headers: { ...browserHeaders(baseURL), "X-Forwarded-For": ips[10] ?? "" },
    });
    expect(next.status()).toBe(status);
    await next.dispose();
    const [user] = await sql<
      { count: number }[]
    >`select count(*)::int as count from login_attempts where key=${keys[0] ?? ""}`;
    expect(user?.count ?? 0).toBeLessThanOrEqual(1);
  } finally {
    await sql`delete from login_attempts where key in ${sql(keys)}`;
    await sql`update users set seed_key=null where id=${student.actor.userId}`;
    await sql.end({ timeout: 1 });
  }
});
test("кривая checksum и межсайтовые запросы не тратят квоту", async ({
  page,
  students,
  loginAs,
  baseURL,
}) => {
  const student = await students.get("anna");
  const sql = createDatabase(1);
  const ip = "192.0.2.71";
  const keys = quotaKeys(student.actor.userId, [ip]);
  try {
    await loginAs("anna");
    const headers = { ...browserHeaders(baseURL), "X-Forwarded-For": ip };
    for (const value of [
      "",
      "x",
      "0".repeat(63),
      "A".repeat(64),
      "g".repeat(64),
      "0".repeat(65),
    ]) {
      expect(
        (
          await page.request.get(`/api/me/briefing/0?checksum=${value}`, {
            headers,
          })
        ).status(),
      ).toBe(400);
    }
    for (const site of [undefined, "cross-site", "same-site", "none"]) {
      const { "Sec-Fetch-Site": _site, ...withoutSite } = headers;
      const requestHeaders: Record<string, string> = { ...withoutSite };
      if (site) requestHeaders["Sec-Fetch-Site"] = site;
      expect(
        (
          await page.request.get(path, {
            headers: requestHeaders,
          })
        ).status(),
      ).toBe(403);
    }
    const [count] = await sql<
      { count: number }[]
    >`select count(*)::int as count from login_attempts where key in ${sql(keys)}`;
    expect(count?.count).toBe(0);
  } finally {
    await sql`delete from login_attempts where key in ${sql(keys)}`;
    await sql.end({ timeout: 1 });
  }
});
