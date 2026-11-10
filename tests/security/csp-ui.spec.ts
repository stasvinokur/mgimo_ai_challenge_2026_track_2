import { expect, test } from "./assistant-fixture";

test("под CSP работают тема, ассистент и тост с сохраняющейся ошибкой формы", async ({
  page,
  loginStudent,
}, info) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { cspViolations: string[] };
    state.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      state.cspViolations.push(event.violatedDirective),
    );
  });
  await loginStudent();
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Переключить тему" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page
    .getByRole("button", { name: "Спросить или сделать", exact: true })
    .click();
  const sheet = page.getByRole("dialog", { name: "Спросить или сделать" });
  await expect(sheet).toBeVisible();
  if (process.env.ASSISTANT_RUNTIME === "mock") {
    await sheet
      .getByRole("button", { name: "Где следующая пара?", exact: true })
      .click();
    await expect(sheet.getByRole("log")).toContainText(
      "Проверьте сведения и источники ниже.",
    );
    const certificate = sheet.getByRole("button", {
      name: "Нужна справка для работодателя",
      exact: true,
    });
    await expect(certificate).toBeEnabled();
    await certificate.click();
    await expect(
      sheet.getByRole("region", { name: "Черновик заявки" }),
    ).toContainText("Справка об обучении");
    await expect(
      sheet.getByRole("button", { name: "Подтвердить отправку", exact: true }),
    ).toBeEnabled();
  }
  await sheet.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(sheet).not.toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { cspViolations: string[] }).cspViolations,
      ),
    )
    .toEqual([]);
  await page.goto("/login");
  // Unique login per run: repeated runs and retries must not hit the 5-per-15-min pair limit.
  await page
    .getByLabel("Логин", { exact: true })
    .fill(`missing-csp-${info.project.name}-${info.retry}-${Date.now()}`);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("wrong-public-test-password");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.locator("form [role=alert]")).toHaveText(
    "Неверный логин или пароль",
  );
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Неверный логин или пароль",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { cspViolations: string[] }).cspViolations,
      ),
    )
    .toEqual([]);
});
