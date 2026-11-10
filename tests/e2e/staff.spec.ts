import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import {
  test as base,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  openStaffFixture,
  type StaffFixture,
} from "../integration/staff-fixtures";
import { loginAs } from "../security/login";
import { loginAsTestStaff } from "../security/staff-login";
import { loginAsTestStudent } from "../security/student-login";

const test = base.extend<{ staffFixture: StaffFixture }>({
  staffFixture: async ({ baseURL }, use) => {
    base.skip(
      !process.env.DATABASE_URL,
      "Нужна тестовая БД лейна для подготовки и очистки заявок.",
    );
    if (!baseURL) throw new Error("Укажите адрес приложения.");
    const fixture = await openStaffFixture();
    try {
      await use(fixture);
    } finally {
      await fixture.close();
    }
  },
});

test("сотрудник открывает свой профиль с доски после редиректа со страницы студента", async ({
  page,
}) => {
  await loginAs(page, "marina");
  await page.goto("/today");
  await expect(page).toHaveURL(/\/staff\/requests$/);
  const profile = page.getByRole("link", { name: "Мой профиль", exact: true });
  await expect(profile).toBeVisible();
  await expect(profile).toHaveAttribute("href", "/staff/profile");
  const box = await profile.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalOverflow(page);
  await profile.click();
  await expect(page).toHaveURL(/\/staff\/profile$/);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Профиль сотрудника",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Марина Петровна Ладова");
  await expect(page.getByRole("main")).toContainText("Факультеты");
});

test("демо-доска не растягивает документ на 360–1920 px", async ({ page }) => {
  await loginAs(page, "marina");
  await page.goto("/staff/requests");
  await expect(
    page.locator("[data-column=submitted] [data-request-id]").first(),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  for (const width of [360, 1024, 1279, 1280, 1440, 1920]) {
    await test.step(`${width} px`, async () => {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
      const columns = page.locator("[data-column]");
      await expect(columns).toHaveCount(6);
      for (const column of await columns.all()) {
        const box = await column.boundingBox();
        expect(box).not.toBeNull();
        expect(box?.x).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      }
    });
  }
});

for (const width of [360, 1280, 1440])
  test(`подписи действий не рвутся и помещаются в кнопки · ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await loginAs(page, "marina");
    await page.goto("/staff/requests");
    const inProgress = page
      .locator("[data-column=in_progress] [data-request-id]")
      .filter({
        has: page.getByRole("button", {
          name: "Нужна информация",
          exact: true,
        }),
      })
      .first();
    await expect(inProgress.locator("fieldset button")).toHaveCount(3);
    await page.evaluate(() => document.fonts.ready);
    await expectReadableButtons(
      page.locator("[data-request-id] fieldset button"),
    );
    await expectReadableButtons(
      page
        .getByRole("form", { name: "Фильтры очереди" })
        .locator("[data-slot=button]"),
    );
    await expectNoHorizontalOverflow(page);
    await inProgress.getByRole("link", { name: /^Открыть заявку/ }).click();
    await expect(page).toHaveURL(/\/staff\/requests\/[0-9a-f-]{36}$/);
    const actions = page.getByRole("region", { name: "Действия сотрудника" });
    await expect(actions.getByRole("button")).toHaveText([
      "Нужна информация",
      "Готова",
      "Отклонить",
    ]);
    await expectReadableButtons(actions.getByRole("button"));
    for (const label of ["Нужна информация", "Отклонить"]) {
      const opener = actions.getByRole("button", { name: label, exact: true });
      await opener.click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Шаблон комментария").selectOption({ index: 1 });
      await expectReadableButtons(dialog.locator("form").getByRole("button"));
      await dialog
        .getByRole("button", { name: "Проверить комментарий", exact: true })
        .click();
      await expect(
        dialog.getByRole("heading", {
          name: "Проверьте комментарий перед отправкой",
        }),
      ).toBeVisible();
      await expectReadableButtons(dialog.locator("form").getByRole("button"));
      await expectNoHorizontalOverflow(page);
      await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(opener).toBeFocused();
    }
  });

test("Тимур подаёт справку, Марина обрабатывает её кнопками, Тимур видит готовность и уведомление", async ({
  page,
  browser,
  baseURL,
  staffFixture: f,
}) => {
  await loginAsTestStudent(page, f.studentCredentials.timur);
  await page.goto("/requests/new?type=enrollment");
  await page.getByLabel("Место требования (обязательно)").fill(f.marker);
  await page
    .getByRole("button", { name: "Проверить заявку", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Подтвердить отправку", exact: true })
    .click();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
  const id = new URL(page.url()).pathname.split("/").at(-1);
  if (!id) throw new Error("Не назначен id заявки.");
  const studentDocumentStart = await page.evaluate(
    () => performance.timeOrigin,
  );
  const employeeContext = await browser.newContext({ baseURL });
  try {
    const employee = await employeeContext.newPage();
    await loginAs(employee, "marina");
    await employee.goto(`/staff/requests/${id}`);
    for (const [button, status] of [
      ["Принять", "Принята"],
      ["В работу", "В работе"],
      ["Готова", "Готова"],
    ]) {
      await employee.getByRole("button", { name: button, exact: true }).click();
      await expect(employee.locator("[aria-current=step]")).toContainText(
        status ?? "",
      );
    }
    await expect(
      employee.locator("dl dd").filter({ hasText: /^Марина Петровна Ладова$/ }),
    ).toBeVisible();
    await page.bringToFront();
    await expect(page.locator("[aria-current=step]")).toContainText("Готова", {
      timeout: 20_000,
    });
    await expect(
      page.getByText("Марина Петровна Ладова", { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(
      studentDocumentStart,
    );
  } finally {
    await employeeContext.close();
  }
  expect(
    await f.sql`select id from notifications where user_id = ${f.timur.userId} and link = ${`/requests/${id}`} and title like '%Готова%'`,
  ).toHaveLength(1);
  expect(
    await f.sql`select id from staff_audit_log where request_id = ${id}`,
  ).toHaveLength(3);
});

for (const branch of ["needs_info", "rejected"] as const)
  test(`${branch}: обязательный комментарий, шаблон и подтверждение`, async ({
    page,
    staffFixture: f,
  }) => {
    const id = await f.request();
    await f.change.execute(f.marina, { id, to: "accepted" });
    await f.change.execute(f.marina, { id, to: "in_progress" });
    await loginAs(page, "marina");
    await page.goto(`/staff/requests/${id}`);
    await page
      .getByRole("button", {
        name: branch === "needs_info" ? "Нужна информация" : "Отклонить",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", { name: "Проверить комментарий", exact: true })
      .click();
    await expect(
      dialog.getByText("Добавьте комментарий.", { exact: true }),
    ).toBeVisible();
    expect((await f.get.execute(f.marina, { id })).status).toBe("in_progress");
    await dialog.getByLabel("Шаблон комментария").selectOption({ index: 1 });
    const comment = await dialog
      .getByLabel("Комментарий (обязательно)")
      .inputValue();
    expect(comment.length).toBeGreaterThan(0);
    await dialog
      .getByRole("button", { name: "Проверить комментарий", exact: true })
      .click();
    await expect(
      dialog.getByRole("heading", {
        name: "Проверьте комментарий перед отправкой",
      }),
    ).toBeVisible();
    expect((await f.get.execute(f.marina, { id })).status).toBe("in_progress");
    await dialog
      .getByRole("button", { name: "Подтвердить отправку", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator("[aria-current=step]")).toContainText(
      branch === "needs_info" ? "Нужна информация" : "Отклонена",
    );
    await expect(page.locator("[aria-current=step]")).toContainText(comment);
    if (branch === "needs_info") {
      const request = await f.get.execute(f.marina, { id });
      await page.goto(
        `/staff/requests?q=${encodeURIComponent(request.publicNo ?? "")}`,
      );
      await expect(
        page.locator(`[data-request-id="${id}"] blockquote`),
      ).toContainText(comment);
      await expectQueueCounts(page);
      await expect(
        page
          .getByRole("region", { name: "Сроки очереди" })
          .locator(".counter-tile")
          .filter({ hasText: "Ждём студента" })
          .locator("strong"),
      ).toHaveText("1");
    }
  });

test("десктоп: перетаскивание меняет статус и подсвечивает только разрешённые колонки", async ({
  page,
  staffFixture: f,
}, info) => {
  test.skip(
    info.project.name !== "desktop",
    "Перетаскивание дополняет кнопки на десктопе.",
  );
  const id = await f.request();
  const row = await f.get.execute(f.marina, { id });
  await loginAs(page, "marina");
  await page.goto(
    `/staff/requests?q=${encodeURIComponent(row.publicNo ?? "")}`,
  );
  const card = page.locator(
    `[data-column=submitted] [data-request-id="${id}"]`,
  );
  const accepted = page.locator("[data-column=accepted]");
  await expect(card).toHaveAttribute("draggable", "true");
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  try {
    await card.dispatchEvent("dragstart", { dataTransfer });
    await expect(accepted).toHaveClass(/ring-primary/);
    await expect(page.locator("[data-column=ready]")).not.toHaveClass(
      /ring-primary/,
    );
    await card.dispatchEvent("dragend", { dataTransfer });
    await expect(accepted).not.toHaveClass(/ring-primary/);
  } finally {
    await dataTransfer.dispose();
  }
  await card.dragTo(accepted);
  await expect(
    page.locator(`[data-column=accepted] [data-request-id="${id}"]`),
  ).toBeVisible();
  expect((await f.get.execute(f.marina, { id })).status).toBe("accepted");
});

test("360 px: колонки доступны с клавиатуры, фильтры сохраняются в URL, действия работают кнопками", async ({
  page,
  staffFixture: f,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const id = await f.request();
  const row = await f.get.execute(f.marina, { id });
  await loginAs(page, "marina");
  await page
    .getByRole("searchbox", { name: "Номер заявки" })
    .fill(row.publicNo ?? "");
  await page
    .getByRole("combobox", { name: "Тип заявки" })
    .selectOption("enrollment");
  await page.getByRole("button", { name: "Применить", exact: true }).click();
  await expect(page).toHaveURL(/q=.*З|q=.*%D0%97/);
  const params = new URL(page.url()).searchParams;
  expect(params.get("q")).toBe(row.publicNo);
  expect(params.get("type")).toBe("enrollment");
  const submitted = page.locator("[data-column=submitted]");
  await submitted.getByRole("button", { name: "Принять", exact: true }).click();
  await expect(submitted.locator(`[data-request-id="${id}"]`)).toHaveCount(0);
  const navigation = page.getByRole("navigation", { name: "Статусы заявок" });
  await navigation.getByRole("link", { name: /^Поданы/ }).focus();
  await page.keyboard.press("Tab");
  const acceptedLink = navigation.getByRole("link", { name: /^Приняты/ });
  await expect(acceptedLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#.*column-accepted$/);
  await page
    .locator("[data-column=accepted]")
    .getByRole("button", { name: "В работу", exact: true })
    .click();
  await page
    .locator("[data-column=in_progress]")
    .getByRole("button", { name: "Готова", exact: true })
    .click();
  await expect(
    page.locator("[data-column=ready]").getByRole("link", {
      name: `Открыть заявку ${row.publicNo}`,
      exact: true,
    }),
  ).toBeVisible();
  for (const button of await page
    .locator(`[data-request-id="${id}"] button`)
    .all()) {
    const box = await button.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

for (const theme of ["light", "dark"] as const)
  test(`экраны staff, axe и снимки · ${theme}`, async ({
    page,
    staffFixture: f,
  }, info) => {
    const viewport =
      info.project.name === "mobile-360"
        ? { width: 360, height: 740 }
        : { width: 1440, height: 900 };
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    await page.addInitScript(
      (value) => localStorage.setItem("pulse-theme", value),
      theme,
    );
    const id = await f.request();
    await loginAs(page, "marina");
    await mkdir(resolve("docs/screenshots"), { recursive: true });
    for (const [screen, path] of [
      ["board", "/staff/requests"],
      ["detail", `/staff/requests/${id}`],
      ["profile", "/staff/profile"],
      ["empty", "/staff/requests?q=З-1999-000000"],
    ]) {
      await page.goto(path ?? "/staff/requests");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (screen === "board" || screen === "empty") {
        await expectQueueCounts(page);
        if (screen === "empty") {
          await expect(page.locator(".counter-tile strong")).toHaveText([
            "0",
            "0",
            "0",
            "0",
          ]);
          await expect(
            page.getByRole("heading", {
              name: "Заявок по выбранным условиям нет",
            }),
          ).toBeVisible();
        }
      }
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({
        path: resolve(
          `docs/screenshots/staff-${screen}-${theme}-${viewport.width}x${viewport.height}.png`,
        ),
        fullPage: true,
        animations: "disabled",
      });
    }
  });

async function expectReadableButtons(buttons: Locator) {
  await expect(buttons.first()).toBeVisible();
  for (const button of await buttons.all()) {
    const metrics = await button.evaluate((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        contentHeight:
          element.clientHeight -
          Number.parseFloat(style.paddingTop) -
          Number.parseFloat(style.paddingBottom),
        lineHeight: Number.parseFloat(style.lineHeight),
        overflowWrap: style.overflowWrap,
        wordBreak: style.wordBreak,
        width: box.width,
        height: box.height,
      };
    });
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
    expect(metrics.lineHeight).toBeGreaterThan(0);
    expect(metrics.contentHeight).toBeLessThanOrEqual(metrics.lineHeight * 2);
    expect(metrics.overflowWrap).toBe("normal");
    expect(metrics.wordBreak).toBe("normal");
    expect(metrics.width).toBeGreaterThanOrEqual(44);
    expect(metrics.height).toBeGreaterThanOrEqual(44);
  }
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
}

async function expectQueueCounts(page: Page) {
  const tiles = page.getByRole("region", { name: "Сроки очереди" });
  for (const [label, selector] of [
    ["Просрочено", '[data-sla="overdue"]'],
    ["Срок скоро", '[data-sla="soon"]'],
    ["В срок", '[data-sla="on_time"]'],
    ["Ждём студента", '[data-status="needs_info"]'],
  ]) {
    const count = await page.locator(`[data-request-id]${selector}`).count();
    await expect(
      tiles
        .locator(".counter-tile")
        .filter({ hasText: label })
        .locator("strong"),
    ).toHaveText(String(count));
  }
  await expect(tiles.getByRole("link")).toHaveCount(3);
}

test("плитки совпадают с доской до и после каждого перехода, готовая заявка выходит из сроков", async ({
  page,
  staffFixture: f,
}) => {
  const id = await f.request();
  await f.sql`update requests set due_at = '2000-01-01T09:00:00Z' where id = ${id}`;
  const row = await f.get.execute(f.marina, { id });
  await loginAs(page, "marina");
  await page.goto(
    `/staff/requests?q=${encodeURIComponent(row.publicNo ?? "")}`,
  );
  const overdue = page
    .getByRole("region", { name: "Сроки очереди" })
    .getByRole("link", { name: /Просрочено/ });
  await expect(overdue.locator("strong")).toHaveText("1");
  await expect(page.locator(`[data-request-id="${id}"]`)).toContainText(
    "Просрочено · срок 1 января",
  );
  await expectQueueCounts(page);
  for (const [button, column] of [
    ["Принять", "accepted"],
    ["В работу", "in_progress"],
    ["Готова", "ready"],
  ]) {
    await page
      .locator(`[data-request-id="${id}"]`)
      .getByRole("button", { name: button, exact: true })
      .click();
    await expect(
      page.locator(`[data-column="${column}"] [data-request-id="${id}"]`),
    ).toBeVisible();
    await expectQueueCounts(page);
    await expect(overdue.locator("strong")).toHaveText(
      column === "ready" ? "0" : "1",
    );
  }
  expect((await f.get.execute(f.marina, { id })).status).toBe("ready");
});

test("плитка «Просрочено» применяет SLA и сохраняет остальные фильтры", async ({
  page,
  staffFixture: f,
}) => {
  const id = await f.request();
  await f.sql`update users set seed_key = ${`staff-filter-e2e:${f.marina.userId}`} where id = ${f.marina.userId}`;
  await f.change.execute(f.marina, { id, to: "accepted" });
  await f.sql`update requests set due_at = '2019-01-01T09:00:00Z' where id = ${id}`;
  const row = await f.get.execute(f.marina, { id });
  const query = new URLSearchParams({
    type: "enrollment",
    scope: "mine",
    q: row.publicNo ?? "",
    sla: "all",
  });
  await loginAsTestStaff(page, f.marinaCredentials);
  await page.goto(`/staff/requests?${query}`);
  await page
    .getByRole("region", { name: "Сроки очереди" })
    .getByRole("link", { name: /Просрочено/ })
    .click();
  await expect(page).toHaveURL(/sla=overdue/);
  expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({
    ...Object.fromEntries(query),
    sla: "overdue",
  });
  await expect(page.getByRole("combobox", { name: "Срок SLA" })).toHaveValue(
    "overdue",
  );
  await expect(page.locator("[data-request-id]")).toHaveCount(1);
  await expect(page.locator(`[data-request-id="${id}"]`)).toContainText(
    "Просрочено",
  );
  await expectQueueCounts(page);
});

test("1440 px: плитки и две карточки «Поданы» помещаются в первый экран", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "desktop",
    "Плотность проверяется на размере эталона.",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAs(page, "marina");
  await page.goto("/staff/requests");
  await expect(
    page.getByRole("region", { name: "Сроки очереди" }),
  ).toBeInViewport({ ratio: 1 });
  const cards = page.locator("[data-column=submitted] [data-request-id]");
  expect(await cards.count()).toBeGreaterThanOrEqual(2);
  await expect(cards.nth(1)).toBeInViewport({ ratio: 1 });
});
