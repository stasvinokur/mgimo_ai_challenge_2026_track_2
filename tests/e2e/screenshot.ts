import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export async function captureScreenshot(
  page: Page,
  path: string,
  {
    fullPage = false,
    heading = true,
    tags,
  }: {
    fullPage?: boolean;
    heading?: boolean;
    tags?: string[];
  } = {},
) {
  if (heading)
    await expect(
      page.getByRole("main").getByRole("heading", { level: 1 }),
    ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await expect
    .poll(async () => {
      const axe = new AxeBuilder({ page });
      if (tags) axe.withTags(tags);
      return (await axe.analyze()).violations;
    })
    .toEqual([]);
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage, animations: "disabled" });
}

export async function capturePwaScreenshot(
  page: Page,
  name: string,
  project: string,
) {
  await captureScreenshot(
    page,
    resolve("docs/screenshots", `pwa-${name}-${project}.png`),
    { fullPage: true },
  );
}
