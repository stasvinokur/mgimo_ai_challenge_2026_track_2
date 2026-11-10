import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  reasonOptions,
  type ScoreReasonCode,
} from "../../src/application/grades/score-reasons";
import { openTeacherGradesTestData } from "../integration/teacher-grades-data";
import { loginAsTestStudent } from "../security/student-login";
import { loginAsTestTeacher } from "../security/teacher-login";

async function checkScreen(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}

async function saveGrade(
  page: Page,
  form: Locator,
  value: string,
  reason: ScoreReasonCode | "" = "",
) {
  await form.getByRole("spinbutton", { name: "Балл", exact: true }).fill(value);
  await form
    .getByRole("combobox", { name: "Причина изменения", exact: true })
    .selectOption(reason);
  const response = page.waitForResponse(
    (reply) =>
      reply.request().method() === "POST" &&
      Boolean(reply.request().headers()["next-action"]),
  );
  await form
    .getByRole("button", { name: "Сохранить балл", exact: true })
    .click();
  await response;
}

for (const theme of ["light", "dark"] as const) {
  test(`ведомость → новый балл → исправление → история и уведомление · ${theme}`, async ({
    page,
    browser,
    baseURL,
  }, info) => {
    test.skip(!process.env.DATABASE_URL, "Нужна БД тестового лейна.");
    const f = await openTeacherGradesTestData();
    const viewport =
      info.project.name === "mobile-360"
        ? { width: 360, height: 740 }
        : { width: 1440, height: 900 };
    const studentContext = await browser.newContext({
      baseURL,
      viewport,
      isMobile: info.project.use.isMobile,
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    try {
      await page.setViewportSize(viewport);
      for (const context of [page.context(), studentContext])
        await context.addInitScript(
          (value) => localStorage.setItem("pulse-theme", value),
          theme,
        );
      await loginAsTestTeacher(page, f.teacher.credentials);
      await page
        .getByRole("navigation", { name: "Основная навигация", exact: true })
        .filter({ visible: true })
        .getByRole("link", { name: "Ведомость", exact: true })
        .click();
      await expect(page).toHaveURL(/\/teacher\/grades$/);
      await page.getByRole("link", { name: new RegExp(f.courseTitle) }).click();
      await expect(page).toHaveURL(new RegExp(`${f.path}$`));
      const form = page.getByRole("form", {
        name: `Студент ведомости — ${f.workTitle}`,
        exact: true,
      });
      await expect(form).toBeVisible();
      await expect(form).toHaveAttribute("data-hydrated", "true");
      const score = form.getByRole("spinbutton", { name: "Балл", exact: true });
      await expect(score).toHaveAttribute("min", "0");
      await expect(score).toHaveAttribute("max", "100");
      await expect(score).toHaveAttribute("step", "1");
      await expect(score).toHaveValue("");
      await expect(form.locator('input[name="expectedScore"]')).toHaveValue("");
      const reason = form.getByRole("combobox", {
        name: "Причина изменения",
        exact: true,
      });
      await expect(reason.getByRole("option")).toHaveText([
        "Выберите причину",
        ...reasonOptions.map((option) => option.label),
      ]);
      await expect(form.locator("textarea")).toHaveCount(0);
      for (const input of await form
        .locator("input:not([type=hidden]),select,button")
        .all()) {
        await expect(input).toBeVisible();
        const box = await input.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect(box?.width).toBeGreaterThanOrEqual(44);
        expect(
          await input.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        ).toBe(true);
      }
      for (const label of await form.locator("label").all()) {
        await expect(label).toBeVisible();
        await expect(label).toHaveCSS("overflow-wrap", "normal");
        expect(
          await label.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        ).toBe(true);
        const geometry = await label.evaluate((element) => ({
          height: element.getBoundingClientRect().height,
          lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
        }));
        expect(geometry.height).toBeLessThanOrEqual(geometry.lineHeight * 2);
      }
      const student = await studentContext.newPage();
      await loginAsTestStudent(student, f.student.credentials);
      await student.goto(`/grades/${f.courseId}`);
      await expect(student.getByRole("slider")).toHaveValue("84");
      const emptyHistory = student.getByRole("region", {
        name: "История изменений",
        exact: true,
      });
      await expect(emptyHistory).toContainText("пока");
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      await checkScreen(page);
      await page.screenshot({
        path: info.outputPath(`teacher-grades-${theme}-${viewport.width}.png`),
        fullPage: true,
        animations: "disabled",
      });
      const staleTab = await page.context().newPage();
      await staleTab.goto(f.path);
      const staleForm = staleTab.getByRole("form", {
        name: `Студент ведомости — ${f.workTitle}`,
        exact: true,
      });
      await expect(staleForm).toHaveAttribute("data-hydrated", "true");
      await expect(
        staleForm.locator('input[name="expectedScore"]'),
      ).toHaveValue("");
      await saveGrade(page, form, "80");
      await expect(form.getByRole("status")).toContainText("Балл сохранён");
      await expect(form.locator('input[name="expectedScore"]')).toHaveValue(
        "80",
      );
      await student.reload();
      await expect(student.getByTestId("grade-course")).toContainText("84");
      await expect(
        student.getByRole("region", { name: "История изменений", exact: true }),
      ).toContainText("Не выставлен → 80");
      await expect(
        staleForm.locator('input[name="expectedScore"]'),
      ).toHaveValue("");
      await saveGrade(staleTab, staleForm, "90", "retake");
      await expect(staleForm.getByRole("alert")).toHaveText(
        "Балл уже изменили, обновите ведомость",
      );
      const [unchanged] = await f.teacher.sql<
        { score: number; events: number; notifications: number }[]
      >`select sc.score,
          (select count(*)::int from score_events where assessment_id = ${f.workId}) as events,
          (select count(*)::int from notifications where user_id = ${f.student.actor.userId} and link = ${`/grades/${f.courseId}`}) as notifications
        from scores sc where sc.assessment_id = ${f.workId} and sc.student_id = ${f.student.actor.studentId}`;
      expect(unchanged).toEqual({ score: 80, events: 1, notifications: 1 });
      await staleForm
        .getByRole("button", { name: "Обновить ведомость", exact: true })
        .click();
      await expect(
        staleForm.locator('input[name="expectedScore"]'),
      ).toHaveValue("80");
      await expect(
        staleForm.getByRole("spinbutton", { name: "Балл", exact: true }),
      ).toHaveValue("80");
      await saveGrade(staleTab, staleForm, "90", "retake");
      await expect(staleForm.getByRole("status")).toContainText(
        "Балл сохранён",
      );
      await expect(
        staleForm.locator('input[name="expectedScore"]'),
      ).toHaveValue("90");
      await staleTab.close();
      await student.reload();
      const history = student.getByRole("region", {
        name: "История изменений",
        exact: true,
      });
      await expect(history).toContainText("Не выставлен → 80");
      await expect(history).toContainText("80 → 90");
      await expect(history).toContainText("Пересдача");
      await expect(history).toContainText("Изменил преподаватель");
      await expect(history).toContainText("МСК");
      await expect(student.getByTestId("grade-course")).toContainText("89");
      await expect(student.getByRole("slider")).toHaveCount(0);
      await expect(student.locator("html")).toHaveClass(new RegExp(theme));
      await checkScreen(student);
      await student.screenshot({
        path: info.outputPath(`grades-history-${theme}-${viewport.width}.png`),
        fullPage: true,
        animations: "disabled",
      });
      await student.goto("/grades");
      await expect(student.getByRole("main")).toContainText(
        "Повышенная стипендия сохраняется",
      );
      await student.goto("/notifications");
      const notification = student
        .locator("li[data-notification-id]")
        .filter({
          has: student.getByRole("heading", {
            name: `Новая оценка: ${f.courseTitle} — ${f.workTitle}`,
            exact: true,
          }),
        })
        .first();
      await expect(notification).toBeVisible();
      await notification.locator(`a[href="/grades/${f.courseId}"]`).click();
      await expect(student).toHaveURL(new RegExp(`/grades/${f.courseId}$`));
      await expect(
        student.getByRole("region", { name: "История изменений", exact: true }),
      ).toContainText("80 → 90");
    } finally {
      await studentContext.close();
      await f.close();
    }
  });
}
