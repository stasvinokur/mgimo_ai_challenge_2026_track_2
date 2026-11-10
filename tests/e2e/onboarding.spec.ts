import { isIP } from "node:net";
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../security/student-login";

// WebAuthn needs a host name: on an IP origin the passkey step is hidden (TASK-42).
const passkeyAvailable = !isIP(
  new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1").hostname,
);
// The push step exists only when the server has VAPID keys (TASK-43): ask the server.
async function expectedSteps(page: Page) {
  const response = await page.request.get("/api/push");
  expect(response.status()).toBe(200);
  const { publicKey } = (await response.json()) as { publicKey: unknown };
  return [
    "schedule",
    "calendar",
    "install",
    "regulations",
    "assistant",
    ...(publicKey ? ["push"] : []),
    ...(passkeyAvailable ? ["passkey"] : []),
  ];
}

async function firstSteps(page: Page) {
  const card = page.getByRole("region", { name: "Первые шаги", exact: true });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-onboarding-ready", "true");
  return card;
}

function step(card: Locator, code: string) {
  return card.locator(`[data-onboarding-step="${code}"]`);
}

test("первокурсник видит шаги в заданном порядке и открывает нужные разделы", async ({
  page,
  loginAs,
}) => {
  await loginAs("timur");
  const card = await firstSteps(page);
  const stepCodes = await expectedSteps(page);
  await expect(card).toContainText(`0 из ${stepCodes.length}`);
  expect(
    await card
      .locator("[data-onboarding-step]")
      .evaluateAll((items) =>
        items.map((item) => item.getAttribute("data-onboarding-step")),
      ),
  ).toEqual(stepCodes);
  await expect(card.getByTestId("today-action")).toHaveCount(0);
  await expect(page.getByTestId("today-action").first()).toContainText(
    "Основы маркетинга — есть долг",
  );
  for (const [code, href] of [
    ["schedule", "/schedule?view=week"],
    ["calendar", "/schedule"],
    ["install", "/today/install"],
    ["regulations", "/regulations?q=стипендия"],
    ["assistant", "/profile/assistant"],
  ] as const)
    await expect(step(card, code).getByRole("link")).toHaveAttribute(
      "href",
      href,
    );
  for (const code of ["calendar", "assistant"]) {
    await expect(step(card, code)).toContainText("Отметится автоматически");
    await expect(step(card, code).getByRole("button")).toHaveCount(0);
  }
  await step(card, "schedule").getByRole("link").click();
  await expect(page).toHaveURL(/\/schedule\?view=week$/);
  await expect(
    page.getByRole("link", { name: "Неделя", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(page).toHaveURL(/\/today$/);
  await firstSteps(page);
  await step(card, "regulations").getByRole("link").click();
  await expect(page).toHaveURL(/\/regulations\?q=/);
  await expect(page.getByRole("main")).toContainText("стипенди");
  await page.goBack();
  await expect(page).toHaveURL(/\/today$/);
  await firstSteps(page);
  await step(card, "assistant").getByRole("link").click();
  await expect(
    page.getByRole("dialog", { name: "Спросить или сделать" }),
  ).toBeVisible();
});

test("ручные отметки и скрытие сохраняются после выхода и нового входа", async ({
  page,
  loginAs,
}) => {
  await loginAs("timur");
  const card = await firstSteps(page);
  const total = (await expectedSteps(page)).length;
  await step(card, "schedule")
    .getByRole("button", { name: /^Готово/ })
    .click();
  await expect(step(card, "schedule")).toContainText("Выполнено");
  await expect(card).toContainText(`1 из ${total}`);
  await page.goto("/profile");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await loginAs("timur");
  await firstSteps(page);
  await expect(step(card, "schedule")).toContainText("Выполнено");
  await expect(card).toContainText(`1 из ${total}`);
  await card
    .getByRole("button", { name: "Скрыть первые шаги", exact: true })
    .click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Сегодня", exact: true }),
  ).toBeVisible();
  await expect(card).toHaveCount(0);
  await page.goto("/profile");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await loginAs("timur");
  await expect(card).toHaveCount(0);
  const progress = await page.request.get("/api/me/onboarding");
  expect(progress.status()).toBe(200);
  expect(await progress.json()).toBeNull();
});

test("подписка на календарь отмечается сама при возвращении на Сегодня", async ({
  page,
  loginAs,
}) => {
  await loginAs("timur");
  const card = await firstSteps(page);
  const total = (await expectedSteps(page)).length;
  await step(card, "calendar").getByRole("link").click();
  await expect(page).toHaveURL(/\/schedule$/);
  await page
    .getByRole("button", { name: "Получить новую ссылку", exact: true })
    .click();
  await expect(
    page.getByLabel("Ссылка для подписки", { exact: true }),
  ).toHaveValue(/^https?:\/\/.+\/api\/calendar\//);
  await page.goto("/today");
  await firstSteps(page);
  await expect(step(card, "calendar")).toContainText("Выполнено");
  await expect(card).toContainText(`1 из ${total}`);
});

test("вопрос ассистенту отмечается без перехода и перезагрузки Сегодня", async ({
  page,
  loginAs,
}) => {
  test.skip(
    process.env.ASSISTANT_RUNTIME !== "mock",
    "Нужен сервер с ASSISTANT_RUNTIME=mock.",
  );
  await loginAs("timur");
  const card = await firstSteps(page);
  const total = (await expectedSteps(page)).length;
  await step(card, "assistant").getByRole("link").click();
  const assistant = page.getByRole("dialog", {
    name: "Спросить или сделать",
    exact: true,
  });
  await expect(assistant).toBeVisible();
  await assistant
    .getByLabel("Ваш вопрос", { exact: true })
    .fill("Где следующая пара?");
  await assistant
    .getByRole("button", { name: "Задать вопрос", exact: true })
    .click();
  await expect(assistant.getByRole("log")).toContainText(
    "Проверьте сведения и источники ниже.",
  );
  await expect(
    assistant.getByRole("button", { name: "Где следующая пара?", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(assistant).toBeHidden();
  await expect(page).toHaveURL(/\/today$/);
  await expect(step(card, "assistant")).toContainText("Выполнено", {
    timeout: 10_000,
  });
  await expect(card).toContainText(`1 из ${total}`);
});

test("ссылка установки использует единственную существующую подсказку PWA", async ({
  page,
  loginAs,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      get: () =>
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    });
  });
  await loginAs("timur");
  const card = await firstSteps(page);
  await step(card, "install").getByRole("link").click();
  await expect(page).toHaveURL(/\/today\/install$/);
  await expect(page.getByRole("main")).toContainText(
    "Подсказка установки появится",
  );
  const install = page.getByRole("region", {
    name: "Установка Пульса",
    exact: true,
  });
  await expect(install).toHaveCount(1);
  await expect(install).toContainText("Поделиться → На экран «Домой»");
});

for (const theme of ["light", "dark"] as const) {
  for (const account of ["anna", "timur"] as const) {
    test(`360 px: ${account}, ${theme}, доступность и снимок первых шагов`, async ({
      page,
      loginAs,
    }, info) => {
      test.skip(
        info.project.name !== "mobile-360",
        "Снимок предназначен для экрана 360 px.",
      );
      await page.setViewportSize({ width: 360, height: 740 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.addInitScript(
        (value) => localStorage.setItem("pulse-theme", value),
        theme,
      );
      await loginAs(account);
      await expect(
        page.getByRole("heading", { name: "Сегодня", exact: true, level: 1 }),
      ).toBeVisible();
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      const card = page.getByRole("region", {
        name: "Первые шаги",
        exact: true,
      });
      if (account === "timur") await firstSteps(page);
      else await expect(card).toHaveCount(0);
      await page.evaluate(() => document.fonts.ready);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth,
          ),
        )
        .toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      const path = info.outputPath(`onboarding-${account}-${theme}-360.png`);
      await page.screenshot({ path, fullPage: true, animations: "disabled" });
      await info.attach(`Первые шаги: ${account}, ${theme}`, {
        path,
        contentType: "image/png",
      });
    });
  }
}
