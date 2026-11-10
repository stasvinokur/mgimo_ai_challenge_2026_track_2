import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../security/student-login";

const titles = {
  schedule: "View your weekly timetable",
  calendar: "Subscribe to your timetable calendar",
  install: "Install Pulse on your phone",
  regulations: "Find the scholarship regulations",
  assistant: "Ask the assistant a question",
  push: "Enable phone notifications",
  passkey: "Add a passkey",
} as const;

async function signIn(
  page: Page,
  credentials: { login: string; password: string },
) {
  await page.goto("/login");
  await expect(page.getByLabel("Language", { exact: true })).toHaveAttribute(
    "data-language-ready",
    "true",
  );
  await page.getByLabel("Username", { exact: true }).fill(credentials.login);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
}

async function firstSteps(page: Page) {
  const card = page.getByRole("region", { name: "First steps", exact: true });
  await expect(card).toHaveAttribute("data-onboarding-ready", "true");
  return card;
}

function step(card: Locator, code: string) {
  return card.locator(`[data-onboarding-step="${code}"]`);
}

test.beforeEach(async ({ context, baseURL }) => {
  if (!baseURL) throw new Error("Нужен адрес приложения.");
  await context.addCookies([
    { name: "pulse-language", value: "en", url: baseURL },
  ]);
});

test("English первые шаги: все включённые подписи, отметка, повтор загрузки и скрытие", async ({
  page,
  students,
}) => {
  await signIn(page, (await students.get("timur")).credentials);
  const card = await firstSteps(page);
  const codes = await card
    .locator("[data-onboarding-step]")
    .evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-onboarding-step")),
    );
  expect(codes.slice(0, 5)).toEqual([
    "schedule",
    "calendar",
    "install",
    "regulations",
    "assistant",
  ]);
  await expect(card).toContainText(`0 of ${codes.length}`);
  for (const code of codes) {
    if (!code || !(code in titles)) throw new Error("Неизвестный шаг.");
    await expect(
      step(card, code).getByRole("link", {
        name: titles[code as keyof typeof titles],
        exact: true,
      }),
    ).toBeVisible();
  }
  for (const code of ["calendar", "assistant", "push", "passkey"]) {
    if (!codes.includes(code)) continue;
    await expect(step(card, code)).toContainText("Completes automatically");
    await expect(step(card, code).getByRole("button")).toHaveCount(0);
  }
  await step(card, "schedule").getByRole("link").click();
  await expect(page).toHaveURL(/\/schedule\?view=week$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/today$/);
  await firstSteps(page);
  const done = step(card, "schedule").getByRole("button", {
    name: `Done : ${titles.schedule}`,
    exact: true,
  });
  await expect(done).not.toHaveAttribute("aria-label");
  await done.click();
  await expect(step(card, "schedule")).toContainText("Completed");
  await expect(card).toContainText(`1 of ${codes.length}`);
  await page.reload();
  await firstSteps(page);
  await expect(step(card, "schedule")).toContainText("Completed");
  await card
    .getByRole("button", { name: "Hide first steps", exact: true })
    .click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("main").getByRole("heading", {
      name: "Today",
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  await expect(card).toHaveCount(0);
});

test("English первые шаги: ошибка сохранения и повтор по нажатию", async ({
  page,
  students,
}) => {
  await signIn(page, (await students.get("timur")).credentials);
  const card = await firstSteps(page);
  let failures = 1;
  await page.route("**/api/me/onboarding", async (route) => {
    if (route.request().method() === "POST" && failures-- > 0) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "UNAVAILABLE" } }),
      });
    } else await route.continue();
  });
  await step(card, "install")
    .getByRole("button", { name: `Done : ${titles.install}`, exact: true })
    .click();
  const error = card.getByRole("alert");
  await expect(error).toContainText(
    "Your progress could not be saved. Please try again.",
  );
  await error.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(step(card, "install")).toContainText("Completed");
  await expect(error).toHaveCount(0);
});

test("English установка: страница и возврат к первым шагам", async ({
  page,
  students,
}) => {
  await signIn(page, (await students.get("timur")).credentials);
  const card = await firstSteps(page);
  await step(card, "install")
    .getByRole("link", { name: titles.install, exact: true })
    .click();
  await expect(page).toHaveURL(/\/today\/install$/);
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { name: titles.install, exact: true, level: 1 }),
  ).toBeVisible();
  await expect(main).not.toContainText("Подсказка установки");
  await main
    .getByRole("link", { name: "Back to first steps", exact: true })
    .click();
  await expect(page).toHaveURL(/\/today$/);
  await firstSteps(page);
});
