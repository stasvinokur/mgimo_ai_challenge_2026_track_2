import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "../security/student-login";

test("поиск ведёт к подсвеченному § 2, фокус и копирование ссылки", async ({
  page,
  loginAs,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await loginAs("anna");
  await page.goto("/regulations");
  await page.getByLabel("Поиск по положениям").fill("повышенная стипендия");
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(page).toHaveURL(/\/regulations\?q=/);
  const result = page.getByRole("link", {
    name: "Академическая и повышенная стипендия",
    exact: true,
  });
  await expect(result).toHaveAttribute("href", "/regulations/scholarship#p-2");
  await expect(page.locator("mark").first()).toBeVisible();
  await result.click();
  await expect(page).toHaveURL(/\/regulations\/scholarship#p-2$/);
  const section = page.locator("#p-2");
  await expect(section).toHaveAttribute("data-highlighted", "true");
  await expect(section).toBeFocused();
  await expect(section).not.toHaveCSS("box-shadow", "none");
  await section
    .getByRole("button", { name: "Скопировать ссылку на пункт 2", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(page.url());
  await page.goto("/regulations/scholarship#p-2");
  await expect(section).toHaveAttribute("data-highlighted", "true");
  await expect(section).toBeFocused();
  await page.getByRole("link", { name: "К пункту § 3", exact: true }).click();
  await expect(page).toHaveURL(/#p-3$/);
  await expect(page.locator("#p-3")).toBeFocused();
  await expect(page.locator("#p-3")).toHaveAttribute(
    "data-highlighted",
    "true",
  );
  await expect(section).not.toHaveAttribute("data-highlighted");
  // Real history navigation (popstate), not a synthetic pushState that fires no event.
  await page.goBack();
  await expect(page).toHaveURL(/#p-2$/);
  await expect(section).toHaveAttribute("data-highlighted", "true");
  await expect(section).toBeFocused();
  await expect(page.locator("#p-3")).not.toHaveAttribute("data-highlighted");
});

test("справка работодателю и пустой поиск", async ({ page, loginAs }) => {
  await loginAs("anna");
  await page.goto(
    `/regulations?q=${encodeURIComponent("справка для работодателя")}`,
  );
  await page
    .getByRole("link", {
      name: "Справка об обучении по месту требования",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/regulations\/certificates#p-3-2$/);
  await expect(page.locator("#p-3-2")).toBeFocused();
  await expect(page.locator("#p-3-2")).toContainText("3 рабочих дня");
  await page.goto("/regulations?q=несуществующеесловоъ");
  await expect(
    page.getByRole("heading", { name: "Подходящих пунктов не найдено" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Вопрос в деканат", exact: true }),
  ).toHaveAttribute("href", "/requests/new?type=question");
  await page.goto("/regulations?q=%20");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "от 1 до 200",
  );
  await page.goto("/regulations?q=%00");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "без управляющих символов",
  );
  await page.goto(`/regulations?q=${encodeURIComponent("Условия назначения")}`);
  const results = page.getByRole("region", { name: "Результаты поиска" });
  await expect(results).toContainText("положении о стипендиях");
  await expect(results).not.toContainText("](/regulations/");
});

for (const theme of ["light", "dark"] as const) {
  for (const view of ["list", "search", "document", "empty"] as const) {
    test(`снимок и axe regulations-${view}-${theme}`, async ({
      page,
      loginAs,
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
      await loginAs("anna");
      const path = {
        list: "/regulations",
        search: `/regulations?q=${encodeURIComponent("повышенная стипендия")}`,
        document: "/regulations/scholarship#p-2",
        empty: "/regulations?q=несуществующеесловоъ",
      }[view];
      await page.goto(path);
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: view === "document" ? "Стипендии" : "Положения деканата",
          exact: true,
        }),
      ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await mkdir(resolve("docs/screenshots"), { recursive: true });
      await page.screenshot({
        path: resolve(
          "docs/screenshots",
          `regulations-${view}-${theme}-${viewport.width}x${viewport.height}.png`,
        ),
        fullPage: true,
        animations: "disabled",
      });
    });
  }
}
