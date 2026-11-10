import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import type { SearchDto } from "@/application/search/dto";
import { test as assistantTest } from "../security/assistant-fixture";
import { expect, test } from "../security/student-login";

async function paletteReady(page: Page) {
  const trigger = page.getByRole("link", { name: /Поиск по кабинету/ });
  await expect(trigger).toHaveAttribute("data-palette-ready", "true");
}

async function expectPaletteDialog(page: Page) {
  const dialog = page.getByRole("dialog", {
    name: "Поиск и действия",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(
    "Найдите в своём кабинете или выберите действие.",
  );
  return dialog;
}

test("Cmd/Ctrl+K, стрелки, Enter и возврат фокуса на триггер", async ({
  page,
  loginAs,
}) => {
  await loginAs("anna");
  await paletteReady(page);
  const trigger = page.getByRole("link", { name: /Поиск по кабинету/ });
  for (const key of ["Meta+k", "Control+k"]) {
    await page.keyboard.press(key);
    await expectPaletteDialog(page);
    const field = page.getByRole("combobox", { name: "Что найти или сделать" });
    await expect(field).toBeFocused();
    await field.press("ArrowDown");
    await expect(
      page.getByRole("option", { name: "Заказать справку", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(field).toHaveAttribute(
      "aria-activedescendant",
      /option-new-request$/,
    );
    await expect(field).toBeFocused();
    await field.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  await trigger.click();
  await expectPaletteDialog(page);
  const field = page.getByRole("combobox");
  await field.press("ArrowDown");
  await field.press("ArrowDown");
  await expect(
    page.getByRole("option", { name: "Неделя", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await field.press("Enter");
  await expect(page).toHaveURL(/\/schedule\?view=week$/);
  await paletteReady(page);
  await page.keyboard.press("Control+k");
  await expectPaletteDialog(page);
});

test("горячая клавиша не перехватывается в поле другой формы", async ({
  page,
  loginAs,
}) => {
  await loginAs("anna");
  await paletteReady(page);
  await page.goto("/search?q=");
  await paletteReady(page);
  const field = page.getByLabel("Что найти", { exact: true });
  await field.focus();
  for (const key of ["Meta+k", "Control+k"]) {
    await field.press(key);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(field).toBeFocused();
  }
  await expect(page.locator(".breadcrumb")).toContainText("Поиск");
  await expect(page.locator(".breadcrumb")).not.toContainText("Страница");
});

test("подсказка пары открывается стрелками и Enter", async ({
  page,
  loginAs,
}) => {
  await loginAs("anna");
  await paletteReady(page);
  await page.getByRole("link", { name: /Поиск по кабинету/ }).click();
  const field = page.getByRole("combobox");
  await field.fill("геогр");
  const first = page
    .getByRole("group", { name: "Расписание", exact: true })
    .getByRole("option")
    .first();
  await expect(first).toContainText("Политическая география");
  const dialog = await expectPaletteDialog(page);
  await expect(
    dialog.getByRole("group", { name: "Заявки", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("group", { name: "Положения", exact: true }),
  ).toHaveCount(0);
  await expect(first.locator("mark").first()).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "Найдено результатов:",
  );
  await field.press("ArrowDown");
  await expect(first).toHaveAttribute("aria-selected", "true");
  await field.press("Enter");
  await expect(page).toHaveURL(/\/schedule\?view=week&week=\d{4}-W\d{2}$/);
  await expect(page.getByRole("main")).toContainText("Политическая география");
});

test("пустой результат, ошибка с повтором и отсутствие старых подсказок после закрытия", async ({
  page,
  loginAs,
}) => {
  await loginAs("anna");
  await paletteReady(page);
  await page.route("**/api/search/suggest?**", (route) =>
    route.fulfill({ status: 429, body: "Слишком много запросов" }),
  );
  await page.keyboard.press("Control+k");
  const field = page.getByRole("combobox");
  await field.fill("геогр");
  const retry = page.getByRole("button", {
    name: "Повторить поиск",
    exact: true,
  });
  await expect(retry).toBeVisible();
  await page.unroute("**/api/search/suggest?**");
  await retry.click();
  await expect(
    page.getByRole("group", { name: "Расписание", exact: true }),
  ).toContainText("Политическая география");
  const emptyQuery = "щщщзз";
  const response = await page.request.get(
    `/api/search/suggest?${new URLSearchParams({ q: emptyQuery })}`,
    { headers: { "Sec-Fetch-Site": "same-origin" } },
  );
  await expect(response).toBeOK();
  const result = (await response.json()) as SearchDto;
  expect(
    result.groups.every(
      (group) => group.status === "ok" && group.items.length === 0,
    ),
  ).toBe(true);
  await field.fill(emptyQuery);
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText(
    "Найдено результатов: 0.",
  );
  await expect(
    page.getByText("Ничего не нашлось", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("group")).toHaveCount(0);
  await expect(
    page.getByRole("option", {
      name: `Спросить ассистента: ${emptyQuery}`,
      exact: true,
    }),
  ).toBeVisible();
  await field.press("Escape");
  await page.keyboard.press("Control+k");
  await expect(field).toHaveValue("");
  await expect(
    page.getByRole("group", { name: "Расписание", exact: true }),
  ).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`палитра: ${theme}, axe, телефон, переносы и видимый выбор`, async ({
    page,
    loginAs,
  }, info) => {
    await page.addInitScript(
      (value) => localStorage.setItem("pulse-theme", value),
      theme,
    );
    await loginAs("anna");
    await paletteReady(page);
    const trigger = page.getByRole("link", { name: /Поиск по кабинету/ });
    const box = await trigger.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await trigger.click();
    const dialog = await expectPaletteDialog(page);
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    if (info.project.name === "mobile-360") {
      const bounds = await dialog.boundingBox();
      expect(bounds?.x).toBe(0);
      expect(bounds?.y).toBe(0);
      expect(bounds?.width).toBe(360);
      expect(bounds?.height).toBe(740);
    }
    for (const query of ["", "геогр", "я".repeat(80)]) {
      await page.getByRole("combobox").fill(query);
      if (query) {
        const text =
          query === "геогр"
            ? /Найдено результатов: [1-9]/
            : "Найдено результатов: 0.";
        await expect(dialog.getByRole("status")).toHaveText(text);
      }
      await page.getByRole("combobox").press("ArrowDown");
      await page.evaluate(() => document.fonts.ready);
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      for (const option of await dialog.getByRole("option").all()) {
        expect(
          await option.evaluate(
            (element) => getComputedStyle(element).overflowWrap,
          ),
        ).toBe("normal");
        expect(
          await option
            .locator("span")
            .first()
            .evaluate(
              (element) =>
                element.getBoundingClientRect().height <=
                Number.parseFloat(getComputedStyle(element).lineHeight) * 2,
            ),
        ).toBe(true);
      }
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
  });
}

assistantTest(
  "палитра передаёт вопрос в ассистент на mock-рантайме",
  async ({ page, loginStudent }) => {
    assistantTest.skip(
      process.env.ASSISTANT_RUNTIME !== "mock",
      "Нужен ASSISTANT_RUNTIME=mock.",
    );
    await loginStudent();
    await paletteReady(page);
    await page.keyboard.press("Control+k");
    const question = "Где следующая пара?";
    await page.getByRole("combobox").fill(question);
    await page
      .getByRole("option", {
        name: `Спросить ассистента: ${question}`,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Поиск и действия" }),
    ).toHaveCount(0);
    const assistant = page.getByRole("dialog", {
      name: "Спросить или сделать",
    });
    await expect(assistant).toBeVisible();
    await expect(
      assistant.getByRole("log").getByText(question, { exact: true }),
    ).toBeVisible();
    await expect(assistant).toContainText(
      "Проверьте сведения и источники ниже.",
    );
    await assistant
      .getByRole("button", { name: "Закрыть", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: /Поиск по кабинету/ }),
    ).toBeFocused();
  },
);
