import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openAttendanceTestData } from "../integration/attendance-data";
import { loginAsTestTeacher } from "../security/teacher-login";

for (const theme of ["light", "dark"] as const) {
  test(`QR → подтверждение → счётчик → личные баллы, axe и 360 px · ${theme}`, async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    test.skip(!process.env.DATABASE_URL, "Нужна БД лейна.");
    const f = await openAttendanceTestData();
    const studentContext = await browser.newContext({
      baseURL,
      viewport: page.viewportSize() ?? undefined,
      isMobile: testInfo.project.use.isMobile,
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    try {
      await page.addInitScript(
        (value) => localStorage.setItem("pulse-theme", value),
        theme,
      );
      await studentContext.addInitScript(
        (value) => localStorage.setItem("pulse-theme", value),
        theme,
      );
      await loginAsTestTeacher(page, f.teacher.credentials);
      await page
        .getByRole("link", { name: "Открыть отметку", exact: true })
        .first()
        .click();
      await expect(page).toHaveURL(new RegExp(`${f.path}$`));
      const roster = page.getByTestId("attendance-roster");
      await expect(roster).toHaveJSProperty("open", false);
      await expect(
        roster.getByText("Студент отметки ·", { exact: false }),
      ).not.toBeVisible();
      await roster.locator("summary").click();
      await expect(roster).toHaveJSProperty("open", true);
      await expect(
        roster.getByText("Студент отметки ·", { exact: false }),
      ).toBeVisible();
      await roster.locator("summary").click();
      await expect(roster).toHaveJSProperty("open", false);
      await page
        .getByRole("button", { name: "Открыть отметку", exact: true })
        .click();
      const link = page.getByTestId("attendance-link");
      await expect(link).toBeVisible();
      await expect(page.getByRole("img", { name: /^QR-код/ })).toBeVisible();
      await expect(
        page.getByRole("status").filter({ hasText: "Отметились" }),
      ).toHaveText("Отметились 0 из 3");
      const first = await link.getAttribute("href");
      await expect
        .poll(() => link.getAttribute("href"), { timeout: 26000 })
        .not.toBe(first);
      const address = await link.getAttribute("href");
      if (!address) throw new Error("QR не выдан.");
      const student = await studentContext.newPage();
      await student.goto(new URL(address).pathname);
      await expect(student).toHaveURL(/\/login\?next=/);
      await student
        .getByLabel("Логин", { exact: true })
        .fill(f.student.credentials.login);
      await student
        .getByLabel("Пароль", { exact: true })
        .fill(f.student.credentials.password);
      await student.getByRole("button", { name: "Войти", exact: true }).click();
      await expect(student).toHaveURL(/\/attend\/[A-Za-z0-9_-]{22}$/);
      await expect(
        student.getByRole("heading", { name: /^Отметиться на паре «/ }),
      ).toBeVisible();
      expect(
        await f.teacher
          .sql`select id from attendance_records where student_id = ${f.student.actor.studentId}`,
      ).toHaveLength(0);
      await student
        .getByRole("button", { name: "Отметиться", exact: true })
        .click();
      await expect(student.getByRole("status")).toHaveText(
        "Отмечено ✓ · +1 балл активности",
      );
      await expect(student).toHaveURL(/\/attend$/);
      await expect(
        page.getByRole("status").filter({ hasText: "Отметились" }),
      ).toHaveText("Отметились 1 из 3");
      for (const current of [page, student]) {
        await expect(current.locator("html")).toHaveClass(new RegExp(theme));
        expect(
          await current.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        for (const button of await current.getByRole("button").all()) {
          if (!(await button.isVisible())) continue;
          expect(
            await button.evaluate(
              (element) => element.scrollWidth <= element.clientWidth,
            ),
          ).toBe(true);
          const geometry = await button.evaluate((element) => ({
            height: element.getBoundingClientRect().height,
            lineHeight: parseFloat(getComputedStyle(element).lineHeight),
          }));
          expect(geometry.height).toBeGreaterThanOrEqual(44);
          expect(geometry.height).toBeLessThanOrEqual(
            geometry.lineHeight * 2 + 24,
          );
        }
        expect(
          (
            await new AxeBuilder({ page: current })
              .withTags([
                "wcag2a",
                "wcag2aa",
                "wcag21a",
                "wcag21aa",
                "wcag22aa",
              ])
              .analyze()
          ).violations,
        ).toEqual([]);
      }
      await page
        .getByRole("button", { name: "Закрыть отметку", exact: true })
        .click();
      await expect(link).toHaveCount(0);
      await expect(
        page.getByText("Отметка закрыта.", { exact: false }),
      ).toBeVisible();
      await student
        .getByRole("link", { name: "Моя посещаемость и баллы", exact: true })
        .click();
      await expect(student).toHaveURL(/\/grades#attendance$/);
      const section = student.getByRole("region", {
        name: "Посещаемость и активность",
      });
      await expect(section).toContainText("Был на 1 из 1 · 100%");
      await expect(section).toContainText("1 из 20 — личная цель");
      await expect(section).not.toContainText("Уважительные причины: 0");
      await expect(section).not.toContainText("Был на 0 из 0");
      const overview = student.getByRole("heading", {
        name: /^(Как у меня дела|Оценок пока нет)$/,
      });
      await expect(overview).toHaveCount(1);
      expect(
        await overview.evaluate((element) => {
          const attendance = document.getElementById("attendance");
          return (
            attendance !== null &&
            Boolean(
              element.compareDocumentPosition(attendance) &
                Node.DOCUMENT_POSITION_FOLLOWING,
            )
          );
        }),
      ).toBe(true);
      await expect(
        section.getByRole("link", { name: "Почему?", exact: true }),
      ).toHaveAttribute("href", "/regulations/attendance#p-5");
      expect(
        (
          await new AxeBuilder({ page: student })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      expect(
        await student.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      await studentContext.close();
      await f.close();
    }
  });
}
