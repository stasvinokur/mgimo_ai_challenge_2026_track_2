import AxeBuilder from "@axe-core/playwright";
import { PAGE_CACHE_PREFIX } from "@/ui/shell/pwa-cache";
import { expect, test } from "../security/student-login";
import {
  englishStudent,
  englishViewport,
  noHorizontalOverflow,
} from "./search-en-helpers";

for (const theme of ["light", "dark"] as const) {
  for (const view of ["today", "week"] as const) {
    test(`English: расписание ${view}, перенос, ${theme}, axe и переносы слов`, async ({
      page,
      context,
      baseURL,
      students,
    }, info) => {
      await englishViewport(page, info);
      await page.addInitScript(
        (value) => localStorage.setItem("pulse-theme", value),
        theme,
      );
      await englishStudent(
        page,
        context,
        baseURL,
        (await students.get("anna")).credentials,
      );
      const response = await page.goto(`/schedule?view=${view}`);
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      await expect(page).toHaveTitle(/Schedule/);
      const main = page.getByRole("main");
      await expect(
        main.getByRole("heading", { name: "Schedule", exact: true, level: 1 }),
      ).toBeVisible();
      await expect(main).toContainText("Times are in Moscow time.");
      const serverDate = response?.headers().date;
      if (!serverDate) throw new Error("Нет времени ответа сервера.");
      const day = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Moscow",
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(new Date(serverDate));
      await expect(
        main.getByRole("heading", { name: `${day} · today`, exact: true }),
      ).toBeVisible();
      if (
        new Date(serverDate).toLocaleDateString("en-GB", {
          timeZone: "Europe/Moscow",
          weekday: "long",
        }) === "Sunday"
      ) {
        await main.getByRole("link", { name: "Go to next study day" }).click();
        await expect(page).toHaveURL(/\/schedule\?view=week&week=/);
      }
      const changes = main.getByTestId("schedule-change");
      await expect(
        changes.filter({ hasText: "Rescheduled to" }).first(),
      ).toContainText("09:00–10:30");
      await expect(
        changes.filter({ hasText: "Rescheduled from" }).first(),
      ).toContainText("13:00–14:30");
      await expect(changes.first()).toContainText(
        "Reason: Учебная встреча перенесена",
      );
      await expect(changes.first()).toContainText("ДЕМО-102");
      await expect(main.getByTestId("schedule-lesson").first()).toContainText(
        "Lecture",
      );
      await expect(main.locator("s").first()).toBeVisible();
      await noHorizontalOverflow(page, main);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await info.attach(`Расписание English ${view} ${theme}`, {
        body: await page.screenshot({ fullPage: true, animations: "disabled" }),
        contentType: "image/png",
      });
    });
  }
}

test("English: недели, пустое воскресенье и ошибка выбора недели", async ({
  page,
  context,
  baseURL,
  students,
}) => {
  await englishStudent(
    page,
    context,
    baseURL,
    (await students.get("anna")).credentials,
  );
  await page.goto("/schedule?view=week");
  const main = page.getByRole("main");
  const selectedWeek = main
    .getByRole("navigation", { name: "Schedule view", exact: true })
    .getByRole("link", { name: "Week", exact: true });
  await expect(selectedWeek).toHaveAttribute("aria-current", "page");
  const weekHref = await selectedWeek.getAttribute("href");
  if (!weekHref) throw new Error("Нет ссылки выбранной недели.");
  const weekURL = new URL(weekHref, page.url()).href;
  const response = await page.goto(weekURL);
  await expect(page).toHaveURL(weekURL);
  const weekNavigation = main.getByRole("navigation", {
    name: "Choose a week",
    exact: true,
  });
  const weekLabel = weekNavigation.locator("p");
  const originalWeekLabel = await weekLabel.textContent();
  if (!originalWeekLabel) throw new Error("Нет подписи выбранной недели.");
  const days = main.locator('[data-slot="card-title"] h2').filter({
    hasText: /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) /,
  });
  await expect(days).toHaveCount(7);
  const sunday = main
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole("heading", { name: /^Sunday / }) });
  await expect(sunday).toContainText("No classes");
  const serverDate = response?.headers().date;
  if (!serverDate) throw new Error("Нет времени ответа сервера.");
  const weekday = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    weekday: "long",
  }).format(new Date(serverDate));
  await expect(sunday).toContainText(
    weekday === "Sunday"
      ? "Your next study day is"
      : "Take a break or check classes for another week.",
  );
  const nextWeek = weekNavigation.getByRole("link", {
    name: "Next week",
    exact: true,
  });
  const nextHref = await nextWeek.getAttribute("href");
  if (!nextHref) throw new Error("Нет ссылки следующей недели.");
  await nextWeek.click();
  await expect(page).toHaveURL(new URL(nextHref, weekURL).href);
  await expect(selectedWeek).toHaveAttribute("href", nextHref);
  await expect(weekLabel).not.toHaveText(originalWeekLabel);
  const previousWeek = weekNavigation.getByRole("link", {
    name: "Previous week",
    exact: true,
  });
  await expect(previousWeek).toHaveAttribute("href", weekHref);
  await previousWeek.click();
  await expect(page).toHaveURL(weekURL);
  await expect(weekLabel).toHaveText(originalWeekLabel);
  await expect(selectedWeek).toHaveAttribute("href", weekHref);
  await expect(selectedWeek).toHaveAttribute("aria-current", "page");
  await page.goto("/schedule?week=2026-W99");
  await expect(main.getByRole("alert")).toHaveText(
    "Could not select the week. Use YYYY-Www, for example 2026-W45.",
  );
  await main.getByRole("link", { name: "Go to today's schedule" }).click();
  await expect(page).toHaveURL(/\/schedule$/);
});

test("English: подписка и перевыпуск ссылки, содержимое ICS остаётся русским", async ({
  page,
  context,
  baseURL,
  students,
}) => {
  await englishStudent(
    page,
    context,
    baseURL,
    (await students.get("anna")).credentials,
  );
  await page.goto("/schedule");
  const main = page.getByRole("main");
  const create = main.getByRole("button", {
    name: "Get a new link",
    exact: true,
  });
  await expect(create).toBeEnabled();
  await expect(create).toHaveAttribute("data-calendar-ready", "true");
  await create.click();
  const url = main.getByLabel("Subscription link", { exact: true });
  await expect(url).toHaveValue(/\/api\/calendar\/[A-Za-z0-9_-]{43}$/);
  const path = new URL(await url.inputValue()).pathname;
  const headers = {
    Origin: new URL(baseURL ?? "").origin,
    "Sec-Fetch-Site": "same-origin",
  };
  const english = await page.request.get(path, { headers });
  expect(english.status()).toBe(200);
  expect(english.headers()["content-type"]).toContain("text/calendar");
  const content = (await english.text()).replaceAll("\r\n ", "");
  expect(content).toContain("X-WR-CALNAME:Пульс — расписание");
  expect(content).toContain("SUMMARY:Политическая география");
  expect(content).toContain("Учебная встреча перенесена");
  await context.addCookies([
    { name: "pulse-language", value: "ru", url: baseURL ?? "" },
  ]);
  const russian = await page.request.get(path, { headers });
  expect(await russian.text()).toBe(await english.text());
  await context.addCookies([
    { name: "pulse-language", value: "en", url: baseURL ?? "" },
  ]);
  await main.getByRole("button", { name: "Replace link", exact: true }).click();
  await expect
    .poll(() => url.inputValue())
    .not.toBe(new URL(path, baseURL).href);
  expect((await page.request.get(path, { headers })).status()).toBe(404);
  await expect(
    main.getByRole("link", { name: "Download .ics file" }),
  ).toHaveAttribute("download", "pulse.ics");
});

test.describe("English: офлайн-расписание", () => {
  test.use({ serviceWorkers: "allow" });
  test("активный SW отдаёт английскую копию с английской пометкой и московской датой", async ({
    page,
    context,
    baseURL,
    students,
  }) => {
    await englishStudent(
      page,
      context,
      baseURL,
      (await students.get("anna")).credentials,
    );
    await expect
      .poll(
        () => page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
        { timeout: 15_000 },
      )
      .toBe(true);
    await page.goto("/schedule");
    await expect
      .poll(
        () =>
          page.evaluate(async (prefix) => {
            const names = (await caches.keys()).filter((name) =>
              name.startsWith(prefix),
            );
            for (const name of names) {
              const response = await (await caches.open(name)).match(
                "/schedule",
              );
              if (
                response &&
                (await response.text()).includes('<html lang="en"')
              )
                return true;
            }
            return false;
          }, PAGE_CACHE_PREFIX),
        { timeout: 20_000 },
      )
      .toBe(true);
    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Schedule", exact: true, level: 1 }),
    ).toBeVisible();
    const banner = page.locator("[data-pwa-offline]");
    await expect(banner).toContainText(
      "You're offline — showing the version saved on",
    );
    await expect(banner).toContainText("(Moscow time)");
    await expect(
      banner.getByRole("button", { name: "Refresh", exact: true }),
    ).toBeVisible();
    const savedAt = await page
      .locator("html")
      .getAttribute("data-pwa-saved-at");
    if (!savedAt) throw new Error("Нет времени сохранённой копии.");
    await expect(banner).toContainText(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Moscow",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(savedAt)),
    );
  });
});
