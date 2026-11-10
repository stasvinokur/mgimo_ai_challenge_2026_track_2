import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { createDatabase } from "@/infrastructure/db/client";
import type { StudentTestData } from "../integration/student-e2e-data";
import { expect, test } from "../security/student-login";
import {
  countScholarshipTextLines,
  measureScholarshipLabel,
} from "./scholarship-label-layout";

async function prepareScholarshipScenario(student: StudentTestData) {
  const sql = createDatabase(1);
  try {
    await sql.begin(async (tx) => {
      const updated =
        await tx`update students set scholarship = 'increased', target_score = 86
        where id = ${student.actor.studentId} and user_id = ${student.actor.userId} and seed_key is null
        returning id`;
      expect(
        updated,
        "Сценарий меняет только временного студента",
      ).toHaveLength(1);
      const scores = await tx<{ seedKey: string; score: number | null }[]>`
        update scores sc set score = case a.seed_key
          when 'demo:assessment:fmo:0:0' then 88
          when 'demo:assessment:fmo:0:1' then 86
          when 'demo:assessment:fmo:0:2' then null
          else 90 end,
          graded_at = case when a.seed_key = 'demo:assessment:fmo:0:2' then null
            else '2026-11-01T09:00:00Z'::timestamptz end
        from assessments a where sc.assessment_id = a.id and sc.student_id = ${student.actor.studentId}
          and a.seed_key like 'demo:assessment:fmo:%'
        returning a.seed_key as "seedKey", sc.score`;
      expect(
        scores,
        "Шесть дисциплин с тремя работами подготовлены явно",
      ).toHaveLength(18);
      expect(
        scores
          .filter((item) => item.seedKey.startsWith("demo:assessment:fmo:0:"))
          .sort((left, right) => left.seedKey.localeCompare(right.seedKey))
          .map((item) => item.score),
      ).toEqual([88, 86, null]);
    });
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function inspectScreen(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  for (const label of await page
    .locator('[data-testid="fork-label"]:visible, main button:visible')
    .all()) {
    await expect(label).toBeVisible();
    const dimensions = await label.evaluate(measureScholarshipLabel);
    const lines = countScholarshipTextLines(dimensions.textRects);
    const diagnostic = JSON.stringify({ ...dimensions, lines });
    expect(dimensions.scrollWidth, diagnostic).toBeLessThanOrEqual(
      dimensions.clientWidth,
    );
    expect(lines, diagnostic).toBeGreaterThan(0);
    expect(lines, diagnostic).toBeLessThanOrEqual(2);
    if (dimensions.isButton) {
      expect(dimensions.width, diagnostic).toBeGreaterThanOrEqual(44);
      expect(dimensions.height, diagnostic).toBeGreaterThanOrEqual(44);
      expect(dimensions.minHeight, diagnostic).toBeGreaterThanOrEqual(44);
    }
    expect(dimensions.wordBreak, diagnostic).not.toBe("break-all");
    expect(
      dimensions.wrap === "normal" || dimensions.whitespace === "nowrap",
      diagnostic,
    ).toBe(true);
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function expectSelected(fork: Locator, selected: "submit" | "skip") {
  for (const branch of ["submit", "skip"] as const) {
    await expect(fork.getByTestId(`fork-${branch}`)).toHaveAttribute(
      "data-selected",
      String(selected === branch),
    );
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`English: стипендия Анны, граница 76/77 и развилка · ${theme}`, async ({
    page,
    loginAs,
    students,
    baseURL,
  }, info) => {
    await page.setViewportSize(
      info.project.name === "mobile-360"
        ? { width: 360, height: 740 }
        : { width: 1440, height: 900 },
    );
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    await page.addInitScript(
      (value) => localStorage.setItem("pulse-theme", value),
      theme,
    );
    await prepareScholarshipScenario(await students.get("anna"));
    await loginAs("anna");
    await page
      .context()
      .addCookies([
        { name: "pulse-language", value: "en", url: baseURL ?? page.url() },
      ]);
    await page.goto("/grades");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    await expect(
      page.getByRole("heading", { name: "Study", level: 1, exact: true }),
    ).toBeVisible();
    const forecast = page.getByTestId("scholarship-forecast");
    await expect(forecast).toBeVisible();
    await expect(forecast.getByTestId("scholarship-headline")).toContainText(
      "Increased scholarship is at risk",
    );
    await expect(forecast).toContainText("at least 77 out of 100");
    await expect(forecast).toContainText("Иностранный язык");
    await inspectScreen(page, info, `scholarship-en-list-${theme}`);
    await forecast
      .getByRole("link", { name: /Open course.*Иностранный язык/ })
      .click();
    await expect(page).toHaveURL(/\/grades\/[0-9a-f-]+$/);
    const courseURL = page.url();
    const response = await page.request.get(`${courseURL}/data`);
    expect(response.status()).toBe(200);
    const before = await response.json();
    const simulation = page.getByRole("region", {
      name: "What if?",
      exact: true,
    });
    await expect(simulation).toHaveAttribute("data-what-if-ready", "true");
    const slider = simulation.getByRole("slider");
    const fork = simulation.getByTestId("grade-outcome-fork");
    await expect(slider).toHaveValue("77");
    await expect(forecast.getByTestId("scholarship-headline")).toHaveText(
      "Increased scholarship is retained.",
    );
    await expect(fork.getByTestId("fork-current")).toHaveText(
      "Current: 78.3 out of 100",
    );
    await expect(fork.getByTestId("fork-submit")).toContainText(
      "Submit with 77 out of 100",
    );
    await expect(fork.getByTestId("fork-submit")).toContainText(
      "Total 86 out of 100",
    );
    await expect(fork.getByTestId("fork-skip")).toContainText(
      "Total 78.3 out of 100",
    );
    await expectSelected(fork, "submit");
    await inspectScreen(page, info, `scholarship-en-77-${theme}`);
    await slider.focus();
    await slider.press("ArrowLeft");
    await expect(slider).toHaveValue("76");
    await expect(simulation.getByRole("status")).toContainText(
      "Projected total: 85.9 out of 100",
    );
    await expect(forecast.getByTestId("scholarship-headline")).toContainText(
      "Increased scholarship is at risk",
    );
    await inspectScreen(page, info, `scholarship-en-76-${theme}`);
    await slider.press("ArrowRight");
    await expect(slider).toHaveValue("77");
    await expect(forecast.getByTestId("scholarship-headline")).toHaveText(
      "Increased scholarship is retained.",
    );
    await simulation.getByRole("button", { name: "Skip", exact: true }).click();
    await expect(slider).toBeDisabled();
    await expectSelected(fork, "skip");
    await expect(forecast.getByTestId("scholarship-headline")).toContainText(
      "there is an outstanding requirement",
    );
    await simulation
      .getByRole("button", { name: "Submit", exact: true })
      .click();
    await expect(slider).toBeEnabled();
    await expectSelected(fork, "submit");
    await expect(forecast.getByTestId("scholarship-headline")).toHaveText(
      "Increased scholarship is retained.",
    );
    const after = await page.request.get(`${courseURL}/data`);
    expect(after.status()).toBe(200);
    expect(await after.json()).toEqual(before);
    await page.reload();
    await expect(slider).toHaveValue("77");
  });
}
