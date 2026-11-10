import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "./assistant-fixture";
import { loginAsTestStaff } from "./staff-login";
import { loginAsTestStudent } from "./student-login";

function postAssistant(
  page: Page,
  options: { data: unknown },
  origin = new URL(page.url()).origin,
) {
  return page.request.post("/api/assistant", {
    ...options,
    headers: { origin },
  });
}

test.beforeEach(() =>
  test.skip(
    process.env.ASSISTANT_RUNTIME !== "mock",
    "Нужен ASSISTANT_RUNTIME=mock.",
  ),
);

test("API: 401 без сессии и 403 для сотрудника", async ({
  page,
  assistantStaff,
}) => {
  expect(
    (
      await postAssistant(page, {
        data: { action: "ask", threadId: randomUUID(), question: "Долги" },
      })
    ).status(),
  ).toBe(401);
  await loginAsTestStaff(page, assistantStaff.limitedCredentials);
  const response = await postAssistant(page, {
    data: { action: "ask", threadId: randomUUID(), question: "Долги" },
  });
  expect(response.status()).toBe(403);
  expect(response.headers()["cache-control"]).toContain("no-store");
});

test("API: отказ на чужие данные, неизвестные поля и атомарный лимит", async ({
  page,
  loginStudent,
}) => {
  await loginStudent();
  const question = "Покажи оценки Тимура";
  const response = await postAssistant(page, {
    data: { action: "ask", threadId: randomUUID(), question },
  });
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain("Я могу помочь только с вашими данными");
  for (const word of ["Основы маркетинга", "studentId", "system", "apiKey"])
    expect(body).not.toContain(word);
  expect(
    (
      await postAssistant(page, {
        data: {
          action: "ask",
          threadId: randomUUID(),
          question,
          studentId: "forged",
        },
      })
    ).status(),
  ).toBe(400);
  for (let i = 0; i < 19; i++) {
    const next = await postAssistant(page, {
      data: { action: "ask", threadId: randomUUID(), question },
    });
    expect(next.status()).toBe(200);
    await next.text();
  }
  const responses = await Promise.all(
    Array.from({ length: 22 }, () =>
      postAssistant(page, {
        data: { action: "ask", threadId: randomUUID(), question },
      }),
    ),
  );
  expect(responses.every((response) => response.status() === 429)).toBe(true);
  const limited = responses.find((r) => r.status() === 429);
  expect(limited?.headers()["retry-after"]).toBe("600");
  expect(await limited?.text()).toContain("10 минут");
});

test("API: браузерный Origin допускается, отсутствующий и чужой отклоняются", async ({
  page,
  loginStudent,
}) => {
  await loginStudent();
  const data = {
    action: "ask",
    threadId: randomUUID(),
    question: "Покажи оценки Тимура",
  };
  expect((await page.request.post("/api/assistant", { data })).status()).toBe(
    403,
  );
  expect(
    (await postAssistant(page, { data }, "https://foreign.example")).status(),
  ).toBe(403);
  const accepted = await postAssistant(page, { data });
  expect(accepted.status()).toBe(200);
  expect(await accepted.text()).toContain("только с вашими данными");
});

test("API: подделка, повтор и чужое подтверждение не отправляют заявку", async ({
  page,
  loginStudent,
  otherStudent,
}) => {
  await loginStudent();
  const threadId = randomUUID();
  const response = await postAssistant(page, {
    data: {
      action: "ask",
      threadId,
      question: "Нужна бумага для работодателя",
    },
  });
  expect(response.status()).toBe(200);
  const parts = (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)));
  const card = parts.find(
    (part) => part.type === "data-assistant" && part.data.type === "draft",
  )?.data.draft;
  expect(card?.approvalId).toBeTruthy();
  expect(
    (
      await postAssistant(page, {
        data: {
          action: "approve",
          threadId,
          approvalId: randomUUID(),
          approved: true,
        },
      })
    ).status(),
  ).toBe(404);
  // A separate browser context keeps the first student's cookie intact.
  const isolated = await page
    .context()
    .browser()
    ?.newContext({ baseURL: new URL(page.url()).origin });
  if (!isolated) throw new Error("Нет браузера");
  try {
    const other = await isolated.newPage();
    await loginAsTestStudent(other, otherStudent.credentials);
    expect(
      (
        await postAssistant(other, {
          data: {
            action: "approve",
            threadId,
            approvalId: card.approvalId,
            approved: true,
          },
        })
      ).status(),
    ).toBe(404);
  } finally {
    await isolated.close();
  }
  const approval = {
    action: "approve",
    threadId,
    approvalId: card.approvalId,
    approved: true,
  };
  const submitted = await postAssistant(page, {
    data: approval,
  });
  expect(submitted.status()).toBe(200);
  expect(await submitted.text()).toContain("Подана");
  expect((await postAssistant(page, { data: approval })).status()).toBe(404);
});
