import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { assistantMessages } from "@/ui/i18n/dictionaries/assistant";
import { expect, test } from "./assistant-fixture";
import { loginAsTestStudent } from "./student-login";

async function ask(page: Page, question: string) {
  const response = await page.request.post("/api/assistant", {
    data: { action: "ask", threadId: randomUUID(), question },
    headers: {
      Origin: new URL(page.url()).origin,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
    },
  });
  expect(response.status()).toBe(200);
  await response.text();
}

test("два входа под временным демо-студентом видят только вопросы своей сессии", async ({
  page,
  assistantStudent,
}) => {
  await assistantStudent.sql`update users set seed_key = ${`assistant-security:${assistantStudent.actor.userId}`}
    where id = ${assistantStudent.actor.userId}`;
  await loginAsTestStudent(page, assistantStudent.credentials);
  const firstQuestion = `Покажи оценки Тимура. Первый посетитель ${randomUUID()}`;
  await ask(page, firstQuestion);
  await page.goto("/profile/assistant");
  await expect(page.getByRole("main")).toContainText(firstQuestion);
  const browser = page.context().browser();
  if (!browser) throw new Error("Нужен браузер для второго входа.");
  const secondContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    const second = await secondContext.newPage();
    await loginAsTestStudent(second, assistantStudent.credentials);
    await second.goto("/profile/assistant");
    await expect(
      second.getByRole("heading", {
        name: assistantMessages.journalTitle.ru,
        exact: true,
      }),
    ).toBeVisible();
    await expect(second.getByRole("main")).not.toContainText(firstQuestion);
    const secondQuestion = `Покажи оценки Тимура. Второй посетитель ${randomUUID()}`;
    await ask(second, secondQuestion);
    await second.goto("/profile/assistant");
    await expect(second.getByRole("main")).toContainText(secondQuestion);
    await expect(second.getByRole("main")).not.toContainText(firstQuestion);
    const firstLog = await assistantStudent.sql<{ sessionId: string }[]>`
      select session_id as "sessionId" from assistant_log
      where user_id = ${assistantStudent.actor.userId} and question = ${firstQuestion}`;
    expect(firstLog[0]?.sessionId).toBeTruthy();
    const forged = await second.request.get(
      `/profile/assistant?sessionId=${firstLog[0]?.sessionId}`,
      {
        headers: {
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "navigate",
        },
      },
    );
    expect(forged.status()).toBe(200);
    const html = await forged.text();
    expect(html).toContain(secondQuestion);
    expect(html).not.toContain(firstQuestion);
    await page.goto("/profile/assistant");
    await expect(page.getByRole("main")).toContainText(firstQuestion);
    await expect(page.getByRole("main")).not.toContainText(secondQuestion);
    const linked = await assistantStudent.sql<{ count: number }[]>`
      select count(distinct session_id)::int as count from assistant_log
      where user_id = ${assistantStudent.actor.userId}`;
    expect(linked[0]?.count).toBe(2);
  } finally {
    await secondContext.close();
  }
});
