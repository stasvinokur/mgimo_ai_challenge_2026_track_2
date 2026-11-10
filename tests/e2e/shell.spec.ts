import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, test } from "@playwright/test";
import { ASSISTANT_OPEN_EVENT } from "../../src/ui/shell/assistant-entry";
import { loginAs } from "../security/login";
import { assistantAnswer, conceptNotice, shellPages } from "./shell-cases";

async function expectClearOf(target: Locator, overlay: Locator) {
  const targetBox = await target.boundingBox();
  const overlayBox = await overlay.boundingBox();
  expect(targetBox).not.toBeNull();
  expect(overlayBox).not.toBeNull();
  if (!targetBox || !overlayBox) return;
  expect(
    targetBox.x + targetBox.width <= overlayBox.x ||
      overlayBox.x + overlayBox.width <= targetBox.x ||
      targetBox.y + targetBox.height <= overlayBox.y ||
      overlayBox.y + overlayBox.height <= targetBox.y,
    `Элемент «${(await target.textContent()) ?? ""}» перекрыт фиксированной панелью или FAB`,
  ).toBe(true);
}

test.beforeEach(async ({ page }, info) => {
  await page.setViewportSize(
    info.project.name === "mobile-360"
      ? { width: 360, height: 740 }
      : { width: 1440, height: 900 },
  );
  await loginAs(page, "anna");
  await page.goto("/today");
});

for (const theme of ["light", "dark"] as const) {
  for (const screen of shellPages) {
    test(`${screen.path}: ${theme}, доступность и границы экрана`, async ({
      page,
      baseURL,
    }) => {
      const externalRequests: string[] = [];
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (
          new URL(request.url()).origin !==
          new URL(baseURL ?? "http://127.0.0.1:3000").origin
        )
          externalRequests.push(request.url());
      });
      await page.addInitScript(
        (value) => localStorage.setItem("pulse-theme", value),
        theme,
      );
      if (screen.path.startsWith("/staff/")) await loginAs(page, "marina");
      await page.goto(screen.path);
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(() =>
          document.fonts.check('400 16px "Golos Text"', "АаЯяЁё"),
        ),
      ).toBe(true);
      await expect(
        page.getByRole("heading", {
          name: screen.title,
          exact: true,
          level: 1,
        }),
      ).toBeVisible();
      if (screen.empty) {
        await expect(
          page.getByRole("heading", { name: screen.empty, exact: true }),
        ).toBeVisible();
      }
      if (!screen.path.startsWith("/staff/")) {
        const headerCount = page.locator("header [data-unread-count]");
        await expect(headerCount).toBeVisible();
        if (page.viewportSize()?.width !== 360) {
          const sidebar = page.getByRole("complementary", {
            name: "Личный кабинет",
          });
          await expect(sidebar).toContainText(conceptNotice);
          const notifications = sidebar.getByRole("link", {
            name: /^Уведомления/,
          });
          await expect(notifications).toBeVisible();
          expect(await notifications.getAttribute("aria-label")).toBeNull();
          const sidebarCount = notifications.locator("[data-unread-count]");
          expect(await sidebarCount.getAttribute("aria-hidden")).toBeNull();
          await expect(notifications).toHaveAccessibleName(
            `Уведомления ${(await sidebarCount.textContent())?.trim()} непрочитанных`,
          );
          await expect(
            notifications.locator("[data-unread-count]"),
          ).toHaveAttribute(
            "data-unread-count",
            (await headerCount.getAttribute("data-unread-count")) ?? "",
          );
        }
      }
      if (page.viewportSize()?.width === 360) {
        const nav = page.locator(".mobile-navigation");
        await expect(nav).toBeVisible();
        for (const label of await nav.locator(".nav-link > span").all()) {
          const metrics = await label.evaluate((element) => ({
            height: element.getBoundingClientRect().height,
            width: element.getBoundingClientRect().width,
            lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
            availableWidth:
              element.parentElement?.getBoundingClientRect().width ?? 0,
          }));
          expect(
            metrics.height,
            (await label.textContent()) ?? "",
          ).toBeLessThanOrEqual(metrics.lineHeight + 0.5);
          expect(
            metrics.width,
            (await label.textContent()) ?? "",
          ).toBeLessThanOrEqual(metrics.availableWidth + 0.5);
        }
        const fab = page.getByRole("button", {
          name: "Спросить или сделать",
          exact: true,
        });
        const hasFab = !screen.path.startsWith("/staff/");
        const actions = page
          .getByRole("main")
          .locator('a[href], button, input, select, textarea, [role="button"]');
        if (hasFab) {
          await expect(fab).toBeVisible();
          const box = await fab.boundingBox();
          expect(box?.width).toBeGreaterThanOrEqual(56);
          expect(box?.height).toBeGreaterThanOrEqual(56);
          expect(box?.width).toBe(box?.height);
          expect(
            await fab.evaluate(
              (element) => getComputedStyle(element).borderRadius,
            ),
          ).toBe("50%");
          await expectClearOf(fab, nav);
          for (const action of await actions.all()) {
            if (!(await action.isVisible())) continue;
            const bounds = await action.boundingBox();
            if (bounds && bounds.y < 740 && bounds.y + bounds.height > 0) {
              await expectClearOf(action, fab);
            }
          }
        }
        await page.evaluate(() =>
          window.scrollTo(0, document.documentElement.scrollHeight),
        );
        // The lowest visible content of main clears the fixed navigation
        // (the last action may sit above non-interactive content).
        const contentBottom = await page.getByRole("main").evaluate((main) =>
          Math.max(
            ...[...main.querySelectorAll("*")]
              .map((element) => element.getBoundingClientRect())
              .filter((rect) => rect.width > 1 && rect.height > 1)
              .map((rect) => rect.bottom),
          ),
        );
        const navTop = (await nav.boundingBox())?.y ?? 0;
        expect(contentBottom).toBeLessThanOrEqual(navTop + 0.5);
        const lastAction = actions.filter({ visible: true }).last();
        await lastAction.scrollIntoViewIfNeeded();
        await expect(lastAction).toBeInViewport({ ratio: 1 });
        await expectClearOf(lastAction, nav);
        if (hasFab) await expectClearOf(lastAction, fab);
      }
      const footer = page.getByRole("contentinfo");
      await expect(footer).toContainText(conceptNotice);
      await footer.scrollIntoViewIfNeeded();
      await expect(
        footer.getByText(conceptNotice, { exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      const targets = page.locator("a, button");
      for (const target of await targets.all()) {
        if (
          !(await target.isVisible()) ||
          (await target.getAttribute("class"))?.includes("skip-link")
        )
          continue;
        const box = await target.boundingBox();
        expect(
          box?.width,
          (await target.textContent()) ?? "",
        ).toBeGreaterThanOrEqual(44);
        expect(
          box?.height,
          (await target.textContent()) ?? "",
        ).toBeGreaterThanOrEqual(44);
      }
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations).toEqual([]);
      expect(externalRequests).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

test("студент проходит все разделы и открывает уведомления", async ({
  page,
}, info) => {
  await page.goto("/today");
  const nav = page
    .getByRole("navigation", { name: "Основная навигация", exact: true })
    .filter({ visible: true });
  await expect(nav).toHaveCount(1);
  const studentPages = shellPages.filter(
    (screen) =>
      screen.path !== "/staff/requests" && screen.path !== "/notifications",
  );
  for (const screen of studentPages) {
    await nav.getByRole("link", { name: screen.title, exact: true }).click();
    await expect(page).toHaveURL(screen.path);
    await expect(
      nav.getByRole("link", { name: screen.title, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", { name: screen.title, exact: true, level: 1 }),
    ).toBeVisible();
  }
  await page
    .getByRole("banner")
    .getByRole("link", { name: "Уведомления" })
    .click();
  await expect(page).toHaveURL("/notifications");
  if (info.project.name === "desktop") {
    await expect(
      page.getByRole("link", { name: "Кабинет сотрудника", exact: true }),
    ).toHaveCount(0);
    await loginAs(page, "marina");
    await expect(page).toHaveURL(/\/staff\/requests$/);
    await expect(
      page.getByRole("link", { name: "Кабинет студента", exact: true }),
    ).toHaveCount(0);
    const staffNav = page
      .getByRole("navigation", { name: "Основная навигация" })
      .filter({ visible: true });
    await expect(
      staffNav.getByRole("link", { name: "Заявки студентов", exact: true }),
    ).toBeVisible();
    await expect(
      staffNav.getByRole("link", { name: "Очередь сегодня", exact: true }),
    ).toBeVisible();
    await expect(staffNav.getByRole("link")).toHaveCount(2);
  }
});

test("тема переключается и сохраняется после перезагрузки и перехода", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/today");
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.getByRole("button", { name: "Переключить тему" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page
    .getByRole("navigation", { name: "Основная навигация" })
    .filter({ visible: true })
    .getByRole("link", { name: "Расписание", exact: true })
    .click();
  await expect(page).toHaveURL("/schedule");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Переключить тему" }).click();
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/light/);
});

test("клавиатура, видимый фокус, sheet и возврат фокуса", async ({ page }) => {
  await page.goto("/today");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "К содержимому" });
  await expect(skip).toBeFocused();
  expect(
    await skip.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  const trigger = page.getByRole("button", { name: "Спросить или сделать" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Спросить или сделать" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".assistant-emblem")).toHaveText("✦");
  await expect(sheet).toContainText("По вашим данным и положениям деканата");
  await expect(sheet.getByLabel("Ваш вопрос", { exact: true })).toBeVisible();
  for (let index = 0; index < 4; index++) {
    await page.keyboard.press("Tab");
    await expect
      .poll(() =>
        sheet.evaluate((element) => element.contains(document.activeElement)),
      )
      .toBe(true);
  }
  await sheet.getByRole("button", { name: "Закрыть", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect
    .poll(() =>
      sheet.evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);
  await page.keyboard.press("Shift+Tab");
  await expect(
    sheet.getByRole("button", { name: "Закрыть", exact: true }),
  ).toBeFocused();
  await expect
    .poll(async () => (await new AxeBuilder({ page }).analyze()).violations)
    .toEqual([]);
  await page.keyboard.press("Escape");
  await expect(sheet).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("неизвестный маршрут показывает 404 с возвратом и плашкой", async ({
  page,
}) => {
  const response = await page.goto("/missing-section");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Страница не найдена", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("contentinfo")).toContainText(conceptNotice);
  await page.getByRole("link", { name: "На сегодня", exact: true }).click();
  await expect(page).toHaveURL("/today");
});

test("все основные разделы достижимы клавишей Tab и открываются Enter", async ({
  page,
}) => {
  await page.goto("/today");
  const expected = ["/today", "/schedule", "/grades", "/requests", "/profile"];
  const visited = new Set<string>();
  let lastHref = "/today";
  for (let step = 0; step < 35 && visited.size < expected.length; step++) {
    await page.keyboard.press("Tab");
    const href = await page.evaluate(() => {
      const active = document.activeElement;
      return active?.closest('nav[aria-label="Основная навигация"]')
        ? active.getAttribute("href")
        : null;
    });
    if (href && expected.includes(href)) {
      visited.add(href);
      lastHref = href;
    }
  }
  expect([...visited].sort()).toEqual([...expected].sort());
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(lastHref);
});

for (const theme of ["light", "dark"] as const) {
  test(`шторка с готовым вопросом: один диалог, один запрос и возврат фокуса · ${theme}`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("pulse-theme", value),
      theme,
    );
    await page.reload();
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    // Waiting for a working client handler ensures hydration before dispatching.
    const trigger = page.getByRole("button", {
      name: "Спросить или сделать",
      exact: true,
    });
    await trigger.click();
    const sheet = page.getByRole("dialog", { name: "Спросить или сделать" });
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requests: { action: string; question: string; threadId: string }[] =
      [];
    await page.route("**/api/assistant", async (route) => {
      requests.push(route.request().postDataJSON());
      if (requests.length === 1) await blocked;
      await route.fulfill(await assistantAnswer("Ответ на вопрос готов."));
    });
    const opener = page.getByRole("button", { name: "Переключить тему" });
    await opener.focus();
    const question = "Где следующая пара?";
    await page.evaluate(
      ({ event, question }) => {
        window.dispatchEvent(new CustomEvent(event, { detail: { question } }));
        window.dispatchEvent(new CustomEvent(event, { detail: { question } }));
      },
      { event: ASSISTANT_OPEN_EVENT, question },
    );
    try {
      await expect(sheet).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect.poll(() => requests.length).toBe(1);
      await expect(
        sheet.getByRole("log").getByText(question, { exact: true }),
      ).toHaveCount(1);
      await expect(
        sheet.getByRole("button", { name: question, exact: true }),
      ).toBeDisabled();
      await page.evaluate((event) => {
        window.dispatchEvent(
          new CustomEvent(event, { detail: { question: "Есть ли долги?" } }),
        );
      }, ASSISTANT_OPEN_EVENT);
      await page.keyboard.press("Escape");
      await expect(opener).toBeFocused();
      await trigger.click();
      await expect(
        sheet.getByRole("log").getByText(question, { exact: true }),
      ).toHaveCount(1);
      expect(requests).toHaveLength(1);
    } finally {
      release();
    }
    const nextQuestion = sheet.getByRole("button", {
      name: "Есть ли долги?",
      exact: true,
    });
    await expect(nextQuestion).toBeEnabled();
    await expect(sheet.getByRole("log")).toContainText(
      "Ответ на вопрос готов.",
    );
    await nextQuestion.click();
    await expect(nextQuestion).toBeEnabled();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests.map((request) => request.action)).toEqual(["ask", "ask"]);
    expect(requests.map((request) => request.question)).toEqual([
      question,
      "Есть ли долги?",
    ]);
    expect(requests[1]?.threadId).toBe(requests[0]?.threadId);
    await expect(sheet.getByRole("log").locator("article")).toHaveCount(4);
    const history = sheet.getByRole("log", { name: "История диалога" });
    await expect(history).toHaveAttribute("tabindex", "0");
    await sheet
      .getByRole("button", {
        name: "Нужна справка для работодателя",
        exact: true,
      })
      .focus();
    await page.keyboard.press("Tab");
    await expect(history).toBeFocused();
    expect(
      await history.evaluate((element) => {
        const style = getComputedStyle(element);
        return { style: style.outlineStyle, width: style.outlineWidth };
      }),
    ).toEqual({ style: "solid", width: "2px" });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect
      .poll(async () => (await new AxeBuilder({ page }).analyze()).violations)
      .toEqual([]);
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  });
}
