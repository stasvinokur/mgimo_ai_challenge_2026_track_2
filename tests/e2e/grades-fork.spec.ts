import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page, TestInfo } from "@playwright/test";
import type { GetCourseGrades } from "@/application/grades/get-my-grades";
import { courseActions } from "@/domain/grades/course-actions";
import { type GradeWork, weightedTotal } from "@/domain/grades/grading-policy";
import {
  initialPredictions,
  type Predictions,
  whatIf,
} from "@/domain/grades/what-if";
import { expect, test } from "../security/student-login";

const scoreText = (value: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);

async function openCourse(page: Page, title: string) {
  await page.goto("/grades");
  await page
    .getByTestId("grade-course")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .getByRole("link", { name: /Подробнее/ })
    .click();
  await expect(page).toHaveURL(/\/grades\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("heading", { level: 1, name: title, exact: true }),
  ).toBeVisible();
  const courseURL = page.url();
  const response = await page.request.get(`${courseURL}/data`);
  expect(response.status()).toBe(200);
  const data = (await response.json()) as Awaited<
    ReturnType<GetCourseGrades["execute"]>
  >;
  return { courseURL, data };
}

async function expectOutcomes(
  fork: Locator,
  works: readonly GradeWork[],
  predictions: Predictions,
  target: number,
  workId: string,
) {
  const work = works.find((item) => item.id === workId);
  const submitted = whatIf(works, predictions, target);
  const branch = submitted.remaining.find((item) => item.id === workId);
  if (!work || !branch) throw new Error("Нужна несданная работа.");
  const skipped = whatIf(works, { ...predictions, [workId]: 0 }, target);
  const score = predictions[workId] ?? 0;
  await expect(fork).toBeVisible();
  await expect(fork.getByTestId("fork-current")).toHaveText(
    `Сейчас: ${scoreText(weightedTotal(works))} из 100`,
  );
  for (const [kind, total, grade, reachesTarget] of [
    [
      "submit",
      branch.submittedTotal,
      submitted.grade.label,
      branch.minimum !== null && score >= branch.minimum,
    ],
    ["skip", branch.skippedTotal, skipped.grade.label, branch.minimum === 0],
  ] as const) {
    const outcome = fork.getByTestId(`fork-${kind}`);
    await expect(outcome.getByTestId("fork-label")).toHaveText(
      kind === "submit"
        ? `Сдать на ${scoreText(score)} из ${scoreText(work.maxScore)}`
        : "Пропустить",
    );
    await expect(outcome.getByTestId("fork-total")).toHaveText(
      `Итог ${scoreText(total)} из 100`,
    );
    await expect(outcome).toContainText(grade);
    await expect(outcome).toContainText(
      `Цель ≥ ${scoreText(target)}: ${reachesTarget ? "достигнута в расчёте" : "пока не достигнута"}`,
    );
  }
  for (const graphic of await fork.locator("svg").all()) {
    await expect(graphic).toHaveAttribute("aria-hidden", "true");
    await expect(graphic).toHaveAttribute("focusable", "false");
  }
}

async function expectSelection(fork: Locator, selected: "submit" | "skip") {
  for (const kind of ["submit", "skip"] as const) {
    const branch = fork.getByTestId(`fork-${kind}`);
    await expect(branch).toHaveAttribute(
      "data-selected",
      String(kind === selected),
    );
    await expect(branch.getByText("Выбрано", { exact: true })).toHaveCount(
      kind === selected ? 1 : 0,
    );
  }
}

async function inspectForks(
  page: Page,
  info: TestInfo,
  name: string,
  stacked = info.project.name === "mobile-360",
) {
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const fork of await page
    .locator('[data-testid="grade-outcome-fork"]:visible')
    .all()) {
    await expect(fork).toBeVisible();
    const submitted = fork.getByTestId("fork-submit");
    const skipped = fork.getByTestId("fork-skip");
    await expect(submitted).toBeVisible();
    await expect(skipped).toBeVisible();
    const first = await submitted.boundingBox();
    const second = await skipped.boundingBox();
    if (!first || !second) throw new Error("Ветки должны иметь геометрию.");
    if (stacked) {
      expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
      expect(Math.abs(second.x - first.x)).toBeLessThanOrEqual(1);
    } else {
      expect(Math.abs(second.y - first.y)).toBeLessThanOrEqual(1);
      expect(second.x).toBeGreaterThanOrEqual(first.x + first.width);
    }
    for (const text of await fork.locator("p").all()) {
      await expect(text).toBeVisible();
      expect(
        await text.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
    }
    for (const label of await fork.getByTestId("fork-label").all()) {
      await expect(label).toBeVisible();
      const box = await label.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          width: element.clientWidth,
          scrollWidth: element.scrollWidth,
          height: element.getBoundingClientRect().height,
          lineHeight: Number.parseFloat(style.lineHeight),
          overflowWrap: style.overflowWrap,
          whiteSpace: style.whiteSpace,
          wordBreak: style.wordBreak,
        };
      });
      expect(box.scrollWidth).toBeLessThanOrEqual(box.width);
      expect(box.height).toBeLessThanOrEqual(box.lineHeight * 2 + 1);
      expect(box.wordBreak).not.toBe("break-all");
      expect(box.overflowWrap === "normal" || box.whiteSpace === "nowrap").toBe(
        true,
      );
    }
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

for (const theme of ["light", "dark"] as const) {
  test(`развилка Анны: граница стипендии 76/77, выбор и обе ветки · ${theme}`, async ({
    page,
    loginAs,
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
    await loginAs("anna");
    const { courseURL, data } = await openCourse(page, "Иностранный язык");
    const work = data.course.works.find((item) => item.score === null);
    if (!work) throw new Error("Нужна работа Анны на границе стипендии.");
    const predictions = initialPredictions(data.course.works, data.targetScore);
    const chosenScore = predictions[work.id];
    if (chosenScore === undefined) throw new Error("Нужен начальный прогноз.");
    const field = page
      .getByRole("region", { name: "Что если?", exact: true })
      .getByRole("group", { name: work.title, exact: true });
    const slider = field.getByRole("slider");
    const fork = field.getByTestId("grade-outcome-fork");
    await expect(slider).toBeVisible();
    await expect(slider).toHaveValue(String(chosenScore));
    await expect
      .poll(() =>
        slider.evaluate((element) =>
          Object.keys(element).some((key) => key.startsWith("__reactFiber")),
        ),
      )
      .toBe(true);
    await expectOutcomes(
      fork,
      data.course.works,
      predictions,
      data.targetScore,
      work.id,
    );
    await expectSelection(fork, "submit");
    await expect(page.getByTestId("scholarship-headline")).toContainText(
      "Повышенная стипендия сохраняется.",
    );
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    await inspectForks(page, info, `anna-${theme}-${chosenScore}`);
    await slider.focus();
    await slider.press("ArrowLeft");
    await expect(slider).toHaveValue(String(chosenScore - 1));
    await expectOutcomes(
      fork,
      data.course.works,
      { ...predictions, [work.id]: chosenScore - 1 },
      data.targetScore,
      work.id,
    );
    await expect(page.getByTestId("scholarship-headline")).toContainText(
      "Повышенная стипендия под угрозой",
    );
    await inspectForks(page, info, `anna-${theme}-${chosenScore - 1}`);
    await slider.press("ArrowRight");
    await expect(slider).toHaveValue(String(chosenScore));
    await field
      .getByRole("button", { name: "Пропустить", exact: true })
      .click();
    await expect(slider).toBeDisabled();
    await expectSelection(fork, "skip");
    await expectOutcomes(
      fork,
      data.course.works,
      predictions,
      data.targetScore,
      work.id,
    );
    await expect(page.getByTestId("scholarship-forecast")).toContainText(
      "Нужно закрыть долг",
    );
    await field.getByRole("button", { name: "Сдать", exact: true }).click();
    await expect(slider).toBeEnabled();
    await expectSelection(fork, "submit");
    expect(await (await page.request.get(`${courseURL}/data`)).json()).toEqual(
      data,
    );
  });

  test(`развилка Тимура: долг и компактные варианты с теми же итогами · ${theme}`, async ({
    page,
    loginAs,
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
    await loginAs("timur");
    const { data } = await openCourse(page, "Основы маркетинга");
    const predictions = initialPredictions(data.course.works, data.targetScore);
    const region = page.getByRole("region", { name: "Что если?", exact: true });
    for (const work of data.course.works.filter(
      (item) => item.score === null,
    )) {
      const fork = region
        .getByRole("group", { name: work.title, exact: true })
        .getByTestId("grade-outcome-fork");
      await expectOutcomes(
        fork,
        data.course.works,
        predictions,
        data.targetScore,
        work.id,
      );
      await expect(fork).toHaveAttribute("data-compact", "false");
      await expectSelection(fork, "submit");
    }
    const expected = courseActions(
      data.course,
      data.targetScore,
      new Date().toISOString(),
    );
    if (!expected) throw new Error("Нужны варианты для долга Тимура.");
    const plan = page.getByTestId("course-actions");
    await plan.locator("summary").click();
    await expect(plan).toHaveAttribute("open", "");
    for (const option of expected.options) {
      if (!option.workId || option.score === null) continue;
      const item = plan.locator("ol > li").filter({
        has: page.getByRole("heading", { name: option.title, exact: true }),
      });
      await expect(item).toContainText(option.effect);
      const fork = item.getByTestId("grade-outcome-fork");
      await expectOutcomes(
        fork,
        data.course.works,
        { [option.workId]: option.score },
        data.targetScore,
        option.workId,
      );
      await expect(fork).toHaveAttribute("data-compact", "true");
      await expect(fork.getByTestId("fork-submit")).toContainText(
        scoreText(option.total),
      );
    }
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    await inspectForks(page, info, `timur-debt-${theme}`);
    await page.setViewportSize({ width: 768, height: 900 });
    await inspectForks(page, info, `timur-debt-${theme}-768`, true);
  });
}
