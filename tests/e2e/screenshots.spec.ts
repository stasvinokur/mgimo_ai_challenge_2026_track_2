import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { type DemoAccount, loginAs } from "../security/login";
import { shellPages } from "./shell-cases";

const screens = [
  ...shellPages.map((screen) => ({
    ...screen,
    account: screen.path.startsWith("/staff/")
      ? ("marina" as const)
      : ("anna" as const),
    filename: screen.path.slice(1).replaceAll("/", "-"),
  })),
  { path: "/login", title: "Вход в «Пульс»", account: null, filename: "login" },
  {
    path: "/staff/profile",
    title: "Профиль сотрудника",
    account: "marina",
    filename: "staff-profile",
  },
  {
    path: "/profile",
    title: "Профиль",
    account: "timur",
    filename: "profile-timur",
  },
] satisfies {
  path: string;
  title: string;
  account: DemoAccount | null;
  filename: string;
}[];

for (const theme of ["light", "dark"] as const) {
  for (const screen of screens) {
    test(`снимок ${screen.filename} ${theme}`, async ({ page }, info) => {
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
      if (screen.account) await loginAs(page, screen.account);
      await page.goto(screen.path);
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      await expect(
        page.getByRole("heading", {
          name: screen.title,
          exact: true,
          level: 1,
        }),
      ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      const directory = resolve("docs/screenshots");
      await mkdir(directory, { recursive: true });
      await page.screenshot({
        path: resolve(
          directory,
          `${screen.filename}-${theme}-${viewport.width}x${viewport.height}.png`,
        ),
        fullPage: false,
        animations: "disabled",
      });
    });
  }
}
