import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "../security/assistant-fixture";

test.beforeEach(() =>
  test.skip(
    process.env.ASSISTANT_RUNTIME !== "mock",
    "Запустите сервер и e2e с ASSISTANT_RUNTIME=mock.",
  ),
);

for (const theme of ["light", "dark"] as const)
  test(`справка работодателю: карточка, источники, подтверждение и трекер · ${theme}`, async ({
    page,
    loginStudent,
    assistantStudent,
  }, info) => {
    await page.addInitScript(
      (value) => localStorage.setItem("pulse-theme", value),
      theme,
    );
    await loginStudent();
    const trigger = page.getByRole("button", {
      name: "Спросить или сделать",
      exact: true,
    });
    await trigger.click();
    const sheet = page.getByRole("dialog", { name: "Спросить или сделать" });
    await sheet
      .getByRole("button", {
        name: "Нужна справка для работодателя",
        exact: true,
      })
      .click();
    const card = sheet.getByLabel("Черновик заявки");
    await expect(card).toContainText("Справка об обучении");
    await expect(card).toContainText("работодателя");
    await expect(card).toContainText("3 рабочих дня");
    await expect(card).toContainText("Черновик · не отправлен");
    await expect(card).toContainText("Без вашего нажатия заявка не уйдёт");
    await expect(
      sheet.getByRole("button", {
        name: "Нужна справка для работодателя",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    const profile = card.getByRole("region", { name: "Данные из профиля" });
    await expect(profile).toContainText("Анна Соколова");
    await expect(profile).toContainText(
      "Из профиля · подставлено автоматически",
    );
    await expect(card.locator("dl").first().locator("dd").first()).toHaveText(
      "работодателя",
    );
    await expect(sheet.getByRole("link", { name: /^§ 3.2/ })).toHaveAttribute(
      "href",
      "/regulations/certificates#p-3-2",
    );
    await expect(
      sheet.getByRole("link", { name: "Основание: § 3.2" }),
    ).toHaveAttribute("href", "/regulations/certificates#p-3-2");
    const confirm = sheet.getByRole("button", {
      name: "Подтвердить отправку",
      exact: true,
    });
    await expect(confirm).toBeEnabled();
    await expect
      .poll(async () => {
        const [before] =
          await assistantStudent.sql`select count(*)::int as n from requests where student_id = ${assistantStudent.actor.studentId} and status = 'submitted' and seed_key is null and payload ->> 'destination' = 'работодателя'`;
        return before?.n;
      })
      .toBe(0);
    await expect
      .poll(async () => (await new AxeBuilder({ page }).analyze()).violations)
      .toEqual([]);
    await expect
      .poll(() =>
        sheet.evaluate((element) => element.scrollWidth <= element.clientWidth),
      )
      .toBe(true);
    if (info.project.name === "mobile-360")
      await expect
        .poll(async () => (await sheet.boundingBox())?.height)
        .toBeGreaterThanOrEqual(730);
    const dir = resolve("docs/screenshots");
    await mkdir(dir, { recursive: true });
    await page.screenshot({
      path: resolve(dir, `assistant-draft-${theme}-${info.project.name}.png`),
      animations: "disabled",
    });
    let approvals = 0;
    page.on("request", (request) => {
      if (
        request.url().endsWith("/api/assistant") &&
        request.postDataJSON()?.action === "approve"
      )
        approvals++;
    });
    await confirm.dblclick();
    const open = sheet.getByRole("link", { name: /^Открыть заявку/ });
    await expect(open).toBeVisible();
    expect(approvals).toBe(1);
    await expect(confirm).toHaveCount(0);
    await open.click();
    await expect(page).toHaveURL(/\/requests\/[0-9a-f-]+$/);
    await expect(page.getByRole("main")).toContainText("Подана");
    await expect(page.getByRole("main")).toContainText("работодателя");
    await expect(page.locator("[aria-current=step]")).toContainText("Подана");
  });

test("после отказа исправленный черновик можно подтвердить в диалоге", async ({
  page,
  loginStudent,
  assistantStudent,
}) => {
  await loginStudent();
  await page
    .getByRole("button", { name: "Спросить или сделать", exact: true })
    .click();
  const sheet = page.getByRole("dialog", { name: "Спросить или сделать" });
  await sheet
    .getByRole("button", {
      name: "Нужна справка для работодателя",
      exact: true,
    })
    .click();
  const cards = sheet.getByLabel("Черновик заявки");
  const first = cards.first();
  await expect(first).toContainText("работодателя");
  const href = await first
    .getByRole("link", { name: "Изменить" })
    .getAttribute("href");
  if (!href) throw new Error("Нет ссылки на черновик");
  const draftId = href.slice("/requests/".length);
  await first
    .getByRole("button", { name: "Не отправлять", exact: true })
    .click();
  await expect(sheet.getByText(/Отправка отменена/)).toBeVisible();
  await expect(
    sheet.getByRole("button", { name: "Подтвердить отправку", exact: true }),
  ).toHaveCount(0);

  await sheet
    .getByLabel("Ваш вопрос")
    .fill("Исправь справку: получатель — Учебный центр «Орион»");
  await sheet
    .getByRole("button", { name: "Задать вопрос", exact: true })
    .click();
  await expect(cards).toHaveCount(2);
  const corrected = cards.last();
  await expect(corrected).toContainText("Учебный центр «Орион»");
  await expect(
    corrected.getByRole("link", { name: "Изменить" }),
  ).toHaveAttribute("href", href);
  await expect(first.getByRole("button")).toHaveCount(0);
  const confirm = corrected.getByRole("button", {
    name: "Подтвердить отправку",
    exact: true,
  });
  await expect(confirm).toBeEnabled();
  await expect
    .poll(async () => {
      const rows = await assistantStudent.sql`
        select id, status from requests
        where student_id = ${assistantStudent.actor.studentId}
          and payload ->> 'destination' = 'Учебный центр «Орион»'`;
      return rows.map((row) => ({ id: row.id, status: row.status }));
    })
    .toEqual([{ id: draftId, status: "draft" }]);
  await confirm.click();
  const open = sheet.getByRole("link", { name: /^Открыть заявку/ });
  await expect(open).toHaveAttribute("href", href);
  await expect(
    sheet.getByRole("button", { name: "Подтвердить отправку", exact: true }),
  ).toHaveCount(0);
  await expect(
    sheet.getByRole("button", { name: "Не отправлять", exact: true }),
  ).toHaveCount(0);
  await open.click();
  await expect(page).toHaveURL(new RegExp(`/requests/${draftId}$`));
  await expect(page.getByRole("main")).toContainText("Подана");
  await expect(page.getByRole("main")).toContainText("Учебный центр «Орион»");
});

test("Escape возвращает фокус, история сохраняется, отказ оставляет черновик", async ({
  page,
  loginStudent,
  assistantStudent,
}, info) => {
  await loginStudent();
  const trigger = page.getByRole("button", {
    name: "Спросить или сделать",
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Спросить или сделать" });
  await sheet.getByLabel("Ваш вопрос").fill("Нужна бумага для работодателя");
  await sheet
    .getByRole("button", { name: "Задать вопрос", exact: true })
    .click();
  const decline = sheet.getByRole("button", {
    name: "Не отправлять",
    exact: true,
  });
  await expect(decline).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(sheet).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(decline).toBeVisible();
  await decline.click();
  await expect(sheet.getByText(/Отправка отменена/)).toBeVisible();
  await expect(
    sheet.getByRole("button", { name: "Подтвердить отправку", exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(async () => {
      const [draft] =
        await assistantStudent.sql`select status from requests where student_id = ${assistantStudent.actor.studentId} and payload ->> 'destination' = 'работодателя'`;
      return draft?.status;
    })
    .toBe("draft");
  await sheet.getByLabel("Ваш вопрос").fill("Покажи оценки Тимура");
  await sheet
    .getByRole("button", { name: "Задать вопрос", exact: true })
    .click();
  await expect(
    sheet.getByText(/Я могу помочь только с вашими данными/),
  ).toBeVisible();
  await expect
    .poll(async () => (await new AxeBuilder({ page }).analyze()).violations)
    .toEqual([]);
  await mkdir(resolve("docs/screenshots"), { recursive: true });
  await page.screenshot({
    path: resolve(
      "docs/screenshots",
      `assistant-refusal-${info.project.name}.png`,
    ),
    animations: "disabled",
  });
});

for (const responseSpeed of ["fast", "pending"] as const)
  test(`два касания через 300 мс: одна отправка и сохранённая шторка · ${responseSpeed}`, async ({
    page,
    loginStudent,
    assistantStudent,
  }, info) => {
    await loginStudent();
    await page
      .getByRole("button", { name: "Спросить или сделать", exact: true })
      .click();
    const sheet = page.getByRole("dialog", { name: "Спросить или сделать" });
    await sheet
      .getByRole("button", {
        name: "Нужна справка для работодателя",
        exact: true,
      })
      .click();
    const card = sheet.getByRole("region", { name: "Черновик заявки" });
    const confirm = card.getByRole("button", {
      name: "Подтвердить отправку",
      exact: true,
    });
    await expect(confirm).toBeEnabled();
    await confirm.scrollIntoViewIfNeeded();
    const position = await confirm.boundingBox();
    if (!position) throw new Error("Нужна кнопка подтверждения");
    const x = position.x + position.width / 2,
      y = position.y + position.height / 2;
    const tap = () =>
      info.project.name === "mobile-360"
        ? page.touchscreen.tap(x, y)
        : page.mouse.click(x, y);
    const gate = Promise.withResolvers<void>();
    let approvals = 0;
    await page.route("**/api/assistant", async (route) => {
      if (route.request().postDataJSON()?.action !== "approve")
        return route.continue();
      approvals++;
      if (responseSpeed === "fast") return route.continue();
      const response = await route.fetch();
      await gate.promise;
      await route.fulfill({ response });
    });
    const url = page.url();
    const open = card.getByRole("link", { name: /^Открыть заявку/ });
    try {
      const firstTapAt = Date.now();
      await tap();
      if (responseSpeed === "pending") {
        const sending = card.getByRole("button", {
          name: "Отправляем…",
          exact: true,
        });
        await expect(sending).toBeDisabled();
        await expect(sending).toHaveAttribute("aria-busy", "true");
        await expect(
          card.getByRole("button", { name: "Не отправлять", exact: true }),
        ).toBeDisabled();
        await expect(
          card.getByRole("button", { name: "Изменить", exact: true }),
        ).toBeDisabled();
        await expect(
          card.getByRole("link", { name: "Изменить", exact: true }),
        ).toHaveCount(0);
        const pendingPosition = await sending.boundingBox();
        expect(pendingPosition?.x).toBeCloseTo(position.x, 0);
        expect(pendingPosition?.y).toBeCloseTo(position.y, 0);
      } else await expect(open).toBeVisible();
      await expect
        .poll(() => Date.now() - firstTapAt, {
          intervals: [25],
          timeout: 5_000,
        })
        .toBeGreaterThanOrEqual(300);
      await tap();
      gate.resolve();
      await expect(sheet).toBeVisible();
      await expect(page).toHaveURL(url);
      await expect(open).toBeVisible();
      await expect(
        sheet.getByRole("link", { name: /^Открыть заявку/ }),
      ).toHaveCount(1);
      await expect(
        card.getByRole("link", { name: "Изменить", exact: true }),
      ).toHaveCount(0);
      expect(approvals).toBe(1);
      const path = await open.getAttribute("href");
      const id = path?.split("/").at(-1);
      await expect
        .poll(async () => {
          const [row] =
            await assistantStudent.sql`select count(*)::int as n from request_events where request_id = ${id ?? ""} and to_status = 'submitted'`;
          return row?.n;
        })
        .toBe(1);
    } finally {
      gate.resolve();
      await page.unrouteAll({ behavior: "wait" });
    }
  });
