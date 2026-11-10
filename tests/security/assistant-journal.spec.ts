import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { PostgresAssistantJournal } from "@/infrastructure/db/repositories/assistant/journal";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { FakeClock } from "../fakes/clock";
import { expect, test } from "./assistant-fixture";
import { loginAsTestStaff } from "./staff-login";
import { loginAsTestTeacher, openTeacherTestData } from "./teacher-login";

const tree = encodeURIComponent(
  JSON.stringify([
    "",
    {
      children: [
        "(student)",
        {
          children: [
            "profile",
            {
              children: [
                "assistant",
                { children: ["__PAGE__", {}, null, "refetch"] },
              ],
            },
          ],
        },
      ],
    },
  ]),
);

test("журнал Анны: HTML и поддельный RSC не раскрывают Тимура, старые записи или сервисные поля", async ({
  page,
  loginStudent,
  assistantStudent,
  otherStudent,
}) => {
  const sql = assistantStudent.sql;
  const now = new Date();
  const journal = new PostgresAssistantJournal(
    () => sql,
    new FakeClock(now.toISOString()),
    new UuidV7Generator(),
  );
  const own = `Вопрос Анны ${randomUUID()}`;
  const foreign = `Вопрос Тимура ${randomUUID()}`;
  const service = `SERVICE_SENTINEL_${randomUUID()}`;
  for (const [userId, question] of [
    [assistantStudent.actor.userId, own],
    [otherStudent.actor.userId, foreign],
  ] as const)
    await journal.append({
      userId,
      question,
      tools: [],
      sources: [],
      outcome: "answered",
    });
  await sql`update assistant_log set tool_calls = ${JSON.stringify([{ systemPrompt: service }])}::text::jsonb where user_id = ${assistantStudent.actor.userId}`;
  const old = "Устаревший вопрос за пределами 14 дней";
  await new PostgresAssistantJournal(
    () => sql,
    new FakeClock(new Date(now.getTime() - 15 * 86_400_000).toISOString()),
    new UuidV7Generator(),
  ).append({
    userId: assistantStudent.actor.userId,
    question: old,
    tools: [],
    sources: [],
    outcome: "answered",
  });
  await loginStudent();
  await page.goto("/profile/assistant");
  await expect(page.getByRole("main")).toContainText(own);
  await expect(page.getByRole("main")).not.toContainText(foreign);
  for (const path of [
    "/profile/assistant",
    `/profile/assistant?userId=${otherStudent.actor.userId}&studentId=${otherStudent.actor.studentId}`,
  ]) {
    const headerVariants: Record<string, string>[] = [
      {},
      { RSC: "1", "Next-Router-State-Tree": tree },
    ];
    for (const headers of headerVariants) {
      const response = await page.request.get(path, {
        headers: {
          ...headers,
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "cors",
        },
      });
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toContain("no-store");
      const body = await response.text();
      expect(body).toContain(own);
      for (const hidden of [foreign, old, service])
        expect(body).not.toContain(hidden);
    }
  }
});

test("аноним и сотрудник перенаправляются, в том числе при поддельном RSC", async ({
  page,
  request,
  assistantStaff,
}) => {
  const anonymous = await request.get("/profile/assistant", {
    maxRedirects: 0,
  });
  expect(anonymous.status()).toBe(307);
  expect(anonymous.headers().location).toContain("/login");
  await loginAsTestStaff(page, assistantStaff.limitedCredentials);
  await page.goto("/profile/assistant");
  await expect(page).toHaveURL(/\/staff\/requests$/);
  await expectForgedFlightRedirect(page, "/staff/requests");
});

test("преподаватель перенаправляется в свой кабинет, в том числе при поддельном RSC", async ({
  page,
}) => {
  const teacher = await openTeacherTestData();
  try {
    await loginAsTestTeacher(page, teacher.credentials);
    await page.goto("/profile/assistant");
    await expect(page).toHaveURL(/\/teacher$/);
    await expectForgedFlightRedirect(page, "/teacher");
  } finally {
    await teacher.close();
  }
});

// Next 16 first answers an RSC request without `_rsc` with a cache-key 307 to the same path.
async function expectForgedFlightRedirect(page: Page, home: string) {
  const flightHeaders = { RSC: "1", "Next-Router-State-Tree": tree };
  async function getFlight(url: string) {
    try {
      return await page.request.get(url, {
        maxRedirects: 0,
        headers: flightHeaders,
      });
    } catch {
      throw new Error("Не удалось выполнить HTTP-проверку RSC.");
    }
  }
  let response = await getFlight("/profile/assistant");
  if (response.status() === 307) {
    const cacheKey = new URL(response.headers().location ?? "", response.url());
    if (
      cacheKey.pathname === new URL(response.url()).pathname &&
      cacheKey.searchParams.has("_rsc")
    ) {
      expect(cacheKey.origin).toBe(new URL(response.url()).origin);
      response = await getFlight(cacheKey.toString());
    }
  }
  expect([200, 307]).toContain(response.status());
  const body = await response.text();
  if (response.status() === 307) {
    const redirected = new URL(
      response.headers().location ?? "",
      response.url(),
    );
    expect(redirected.origin).toBe(new URL(response.url()).origin);
    expect(redirected.pathname).toBe(home);
  } else {
    expect(response.headers()["content-type"]).toContain("text/x-component");
    expect(body).toContain(`NEXT_REDIRECT;replace;${home};307;`);
  }
  expect(body).not.toContain("Последние обращения");
  expect(body).not.toContain("Пока нет записей");
}

test("вопрос — текст, длинная строка не раздвигает страницу, «Не отправлять» в вопросе не означает отказ", async ({
  page,
  loginStudent,
  assistantStudent,
}) => {
  const question = `<img src=x onerror="window.JOURNAL_XSS=true">${"ДлинныйВопрос".repeat(100)}`;
  const journal = new PostgresAssistantJournal(
    () => assistantStudent.sql,
    { now: () => new Date() },
    new UuidV7Generator(),
  );
  await journal.append({
    userId: assistantStudent.actor.userId,
    question,
    tools: [],
    sources: ["javascript:alert(1)"],
    outcome: "answered",
  });
  await journal.append({
    userId: assistantStudent.actor.userId,
    question: "Не отправлять",
    tools: [],
    sources: [],
    outcome: "drafted",
  });
  await loginStudent();
  await page.goto("/profile/assistant");
  const main = page.getByRole("main");
  await expect(main).toContainText(question);
  await expect(main.locator("img")).toHaveCount(0);
  await expect(main.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(main).toContainText("Подготовил черновик");
  await expect(main).not.toContainText("Не отправлено, черновик сохранён");
  await expect(main.getByText("Ваш вопрос", { exact: true })).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(await page.evaluate(() => "JOURNAL_XSS" in window)).toBe(false);
  const scroll = main.getByText(question, { exact: true });
  await scroll.focus();
  await expect(scroll).toBeFocused();
  const before = await scroll.evaluate((element) => element.scrollTop);
  await page.keyboard.press("End");
  await expect
    .poll(() => scroll.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(before);
});
