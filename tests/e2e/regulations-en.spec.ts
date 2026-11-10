import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "../security/student-login";

for (const theme of ["light", "dark"] as const) {
  test(`English: поиск, оглавление, копирование и пустое состояние, ${theme}`, async ({
    page,
    context,
    loginAs,
    baseURL,
  }, info) => {
    if (!baseURL) throw new Error("Нужен адрес приложения");
    await page.setViewportSize(
      info.project.name === "mobile-360"
        ? { width: 360, height: 740 }
        : { width: 1440, height: 900 },
    );
    await page.addInitScript(
      (value) => localStorage.setItem("pulse-theme", value),
      theme,
    );
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await loginAs("anna");
    await context.addCookies([
      { name: "pulse-language", value: "en", url: baseURL },
    ]);
    await page.goto("/regulations");
    const main = page.getByRole("main");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    await expect(
      main.getByRole("heading", {
        level: 1,
        name: "Dean’s office regulations",
      }),
    ).toBeVisible();
    await expect(main).toContainText("texts are available in Russian");
    await expect(
      main.getByRole("link", { name: "Стипендии", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`catalog-en-${theme}.png`),
      fullPage: true,
    });
    await main
      .getByLabel("Search regulations", { exact: true })
      .fill("повышенная стипендия");
    await main.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/\/regulations\?q=/);
    const results = main.getByRole("region", { name: "Search results" });
    await results
      .getByRole("link", {
        name: "Академическая и повышенная стипендия",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/regulations\/scholarship#p-2$/);
    const section = main.locator("#p-2");
    await expect(section).toBeFocused();
    await expect(section).toHaveAttribute("data-highlighted", "true");
    const copy = section.getByRole("button", {
      name: "Copy link to section 2",
      exact: true,
    });
    await expect(copy).toHaveAttribute("data-copy-ready", "true");
    expect(await copy.getAttribute("aria-label")).toBeNull();
    await copy.click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(page.url());
    await main
      .getByRole("navigation", { name: "Regulation sections" })
      .getByRole("link", { name: "Go to § 3", exact: true })
      .click();
    await expect(page).toHaveURL(/#p-3$/);
    await expect(main.locator("#p-3")).toBeFocused();
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await main.evaluate(
        (element) =>
          getComputedStyle(element.firstElementChild as Element).overflowWrap,
      ),
    ).toBe("normal");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`document-en-${theme}.png`),
      fullPage: true,
    });
    await page.goto("/regulations?q=несуществующеесловоъ");
    await expect(
      main.getByRole("heading", { name: "No matching sections" }),
    ).toBeVisible();
    await expect(
      main.getByRole("link", { name: "Ask the dean’s office" }),
    ).toHaveAttribute("href", "/requests/new?type=question");
    await page.goto("/regulations?q=%00");
    await expect(
      main.getByRole("alert").filter({ hasText: "1–200 characters" }),
    ).toBeVisible();
  });
}
