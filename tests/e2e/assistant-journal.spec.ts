import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "../security/assistant-fixture";

test.beforeEach(() =>
  test.skip(
    process.env.ASSISTANT_RUNTIME !== "mock",
    "Нужен ASSISTANT_RUNTIME=mock.",
  ),
);

for (const theme of ["light", "dark"] as const) {
  for (const approved of [true, false]) {
    test(`журнал: вопрос, источники и ${approved ? "подтверждение" : "отказ"} · ${theme}`, async ({
      page,
      loginStudent,
    }, info) => {
      await page.addInitScript(
        (value) => localStorage.setItem("pulse-theme", value),
        theme,
      );
      await loginStudent();
      await page.goto("/profile");
      await page
        .getByRole("link", { name: "Мой журнал ассистента", exact: true })
        .click();
      await expect(page).toHaveURL(/\/profile\/assistant$/);
      await expect(
        page.getByRole("heading", { name: "Пока нет записей" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Спросить ассистента", exact: true })
        .click();
      const sheet = page.getByRole("dialog", { name: "Спросить или сделать" });
      const question = "Нужна справка для работодателя";
      await sheet.getByLabel("Ваш вопрос").fill(question);
      await sheet
        .getByRole("button", { name: "Задать вопрос", exact: true })
        .click();
      const decision = sheet.getByRole("button", {
        name: approved ? "Подтвердить отправку" : "Не отправлять",
        exact: true,
      });
      await expect(decision).toBeEnabled();
      await decision.click();
      if (approved)
        await expect(
          sheet.getByRole("link", { name: /^Открыть заявку/ }),
        ).toBeVisible();
      else await expect(sheet.getByText(/Отправка отменена/)).toBeVisible();
      await expect(
        sheet.getByText("Думаю… Ответ может занять некоторое время."),
      ).not.toBeVisible();
      await sheet
        .getByRole("link", { name: "Мой журнал", exact: true })
        .click();
      await expect(page).toHaveURL(/\/profile\/assistant$/);
      await expect(sheet).not.toBeVisible();
      const main = page.getByRole("main");
      await expect(
        main.getByRole("heading", { name: "Мой журнал ассистента", level: 1 }),
      ).toBeVisible();
      await expect(main).toContainText(
        "ИИ не отправляет заявки без вашего подтверждения",
      );
      await expect(main).toContainText("Записи хранятся 14 дней");
      await expect(main).toContainText(question);
      await expect(main).toContainText("Подготовил черновик");
      await expect(main).toContainText(
        approved ? "Заявка подана" : "Не отправлено, черновик сохранён",
      );
      await expect(main.getByRole("listitem").first()).toContainText(
        approved ? "Подтвердить отправку" : "Не отправлять",
      );
      await expect(main.getByRole("listitem").first()).toContainText(
        "Ваше действие",
      );
      await expect(main.getByRole("listitem").first()).not.toContainText(
        "Ваш вопрос",
      );
      const source = main.getByRole("link", { name: /§ 3\.2/ });
      await expect(source).toHaveAttribute(
        "href",
        "/regulations/certificates#p-3-2",
      );
      await expect(main.locator("time").first()).toContainText("МСК");
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      const questionText = main.locator("dd[tabindex='0']").last();
      await questionText.focus();
      await expect(questionText).toBeFocused();
      if (info.project.name === "mobile-360") {
        const box = await source.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
      if (approved) {
        await main
          .getByRole("link", { name: "Мои заявки", exact: true })
          .click();
        await expect(page).toHaveURL(/\/requests$/);
      } else {
        await source.click();
        await expect(page).toHaveURL(/\/regulations\/certificates#p-3-2$/);
      }
    });
  }
}

test("пустой журнал доступен в обеих темах и открывает ассистента", async ({
  page,
  loginStudent,
}) => {
  await loginStudent();
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate(
      (value) => localStorage.setItem("pulse-theme", value),
      theme,
    );
    await page.goto("/profile/assistant");
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    await expect(
      page.getByRole("heading", { name: "Пока нет записей" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  await page
    .getByRole("button", { name: "Спросить ассистента", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Спросить или сделать" }),
  ).toBeVisible();
});
