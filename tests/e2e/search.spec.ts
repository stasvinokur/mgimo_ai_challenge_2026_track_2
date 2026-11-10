import AxeBuilder from "@axe-core/playwright";
import type { Route } from "@playwright/test";
import { searchRequestsForStudent } from "../integration/search-data";
import { expect, loginAsTestStudent, test } from "../security/student-login";
import { conceptNotice } from "./shell-cases";

test("поиск с клавиатуры в оболочке ведёт к паре, своей заявке и пункту положения", async ({
  page,
  students,
  loginAs,
}, info) => {
  await page.setViewportSize(
    info.project.name === "mobile-360"
      ? { width: 360, height: 740 }
      : { width: 1440, height: 900 },
  );
  await loginAs("anna");
  const entry = page.getByRole("link", { name: /Поиск по кабинету/ });
  await expect(entry).toHaveAttribute("data-palette-ready", "true");
  const box = await entry.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await entry.click();
  await page.getByRole("combobox").fill("география");
  await page
    .getByRole("link", { name: "Открыть страницу поиска", exact: true })
    .click();
  await expect(page).toHaveURL(/\/search\?q=/);
  const schedule = page.getByRole("region", {
    name: "Расписание",
    exact: true,
  });
  const lesson = schedule
    .getByRole("link")
    .filter({ hasText: "Политическая география" })
    .first();
  await expect(lesson).toHaveAttribute(
    "href",
    /\/schedule\?view=week&week=\d{4}-W\d{2}/,
  );
  await expect(lesson.locator("mark").first()).toBeVisible();
  await lesson.click();
  await expect(page).toHaveURL(/\/schedule\?view=week&week=/);
  await expect(page.getByRole("main")).toContainText("Политическая география");

  const anna = await students.get("anna");
  const own = (await searchRequestsForStudent(anna.actor.studentId))[0];
  if (!own) throw new Error("Нет заявки тестовой Анны.");
  await page.goto(
    `/search?${new URLSearchParams({ q: own.publicNo.slice(-8) })}`,
  );
  await page.locator(`a[href="/requests/${own.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/requests/${own.id}$`));
  await expect(page.getByRole("main")).toContainText(own.publicNo);

  await page.goto(`/search?${new URLSearchParams({ q: "академотпуск" })}`);
  const regulation = page
    .getByRole("region", { name: "Положения", exact: true })
    .getByRole("link")
    .first();
  const href = await regulation.getAttribute("href");
  expect(href).toMatch(/^\/regulations\/[a-z-]+#p-\d/);
  await regulation.click();
  await expect(page).toHaveURL(new URL(href ?? "", page.url()).href);
  const anchor = href?.split("#")[1];
  await expect(page.locator(`#${anchor}`)).toBeFocused();
});

test("пустой результат, длина и предложение ассистента", async ({
  page,
  loginAs,
}) => {
  await loginAs("anna");
  await page.goto("/search?q=ёлка");
  await expect(
    page.getByRole("heading", { name: "Ничего не найдено" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Спросить ассистента", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Закрыть", exact: true })
    .click();
  for (const q of ["а", "а".repeat(81)]) {
    await page.goto(`/search?${new URLSearchParams({ q })}`);
    await expect(page.getByLabel("Что найти")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "от 2 до 80",
    );
  }
});

test("обычные GET-формы работают без JavaScript", async ({
  browser,
  baseURL,
  students,
}, info) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport:
      info.project.name === "mobile-360"
        ? { width: 360, height: 740 }
        : { width: 1440, height: 900 },
  });
  try {
    const page = await context.newPage();
    await loginAsTestStudent(page, (await students.get("anna")).credentials);
    await page.getByRole("link", { name: /Поиск по кабинету/ }).click();
    await expect(page).toHaveURL(/\/search\?q=$/);
    await page.getByLabel("Что найти").fill("география");
    await page.getByRole("button", { name: "Найти", exact: true }).click();
    await expect(page).toHaveURL(/\/search\?q=/);
    await expect(
      page.getByRole("region", { name: "Расписание", exact: true }),
    ).toContainText("Политическая география");
  } finally {
    await context.close();
  }
});

test("клиентский поиск показывает ожидание, пока ответ удерживается", async ({
  page,
  loginAs,
}, info) => {
  await page.setViewportSize(
    info.project.name === "mobile-360"
      ? { width: 360, height: 740 }
      : { width: 1440, height: 900 },
  );
  await loginAs("anna");
  await page.goto("/search?q=");
  const field = page.getByRole("searchbox", {
    name: "Что найти",
    exact: true,
  });
  const form = page.locator('form[action="/search"]').filter({ has: field });
  await expect(form).not.toHaveAttribute("aria-busy");
  // Hydrate the handler before testing the enhanced submission.
  await expect
    .poll(() =>
      form.evaluate((element) =>
        Object.keys(element).some((key) => key.startsWith("__reactFiber")),
      ),
    )
    .toBe(true);
  const q = "география";
  const release = Promise.withResolvers<void>();
  let held = false;
  const matcher = (url: URL) =>
    url.pathname === "/search" && url.searchParams.get("q") === q;
  const handler = async (route: Route) => {
    held = true;
    await release.promise;
    await route.continue();
  };
  await page.route(matcher, handler);
  let submission: Promise<void> | undefined;
  try {
    await field.fill(q);
    submission = field.press("Enter");
    await expect.poll(() => held).toBe(true);
    await expect(form).toHaveAttribute("aria-busy", "true");
    const pending = page.getByRole("region", {
      name: "Загрузка поиска",
      exact: true,
    });
    await expect(pending).toBeVisible();
    await expect(pending.getByRole("status")).toHaveText("Ищем по кабинету…");
    await expect(pending.locator('[data-slot="skeleton"]')).toHaveCount(2);
    release.resolve();
    await submission;
    await expect(page).toHaveURL(
      (url) => url.pathname === "/search" && url.searchParams.get("q") === q,
    );
    await expect(form).not.toHaveAttribute("aria-busy");
    await expect(pending).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Расписание", exact: true }),
    ).toContainText("Политическая география");
  } finally {
    release.resolve();
    await submission;
    await page.unroute(matcher, handler);
  }
});

for (const theme of ["light", "dark"] as const) {
  for (const q of [
    "",
    "география",
    "ёлка",
    "а",
    "а".repeat(81),
    "академотпуск",
  ]) {
    test(`поиск ${q.slice(0, 12) || "пустой"}: ${theme}, axe и 360 px`, async ({
      page,
      loginAs,
    }, info) => {
      await page.setViewportSize(
        info.project.name === "mobile-360"
          ? { width: 360, height: 740 }
          : { width: 1440, height: 900 },
      );
      await page.addInitScript(
        (value) => localStorage.setItem("pulse-theme", value),
        theme,
      );
      await loginAs("anna");
      await page.goto(`/search?${new URLSearchParams({ q })}`);
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      await expect(
        page.getByRole("heading", {
          name: "Поиск по кабинету",
          exact: true,
          level: 1,
        }),
      ).toBeVisible();
      await expect(page.locator("footer")).toContainText(conceptNotice);
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    });
  }
}
