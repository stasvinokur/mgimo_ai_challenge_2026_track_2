import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { openAttendanceTestData } from "../integration/attendance-data";
import { loginAsTestTeacher } from "../security/teacher-login";

async function inspect(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const button of await page.locator("main button:visible").all()) {
    const geometry = await button.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        fits: element.scrollWidth <= element.clientWidth,
        height: element.getBoundingClientRect().height,
        line: Number.parseFloat(style.lineHeight),
        padding:
          Number.parseFloat(style.paddingTop) +
          Number.parseFloat(style.paddingBottom),
        wrap: style.overflowWrap,
        whiteSpace: style.whiteSpace,
        wordBreak: style.wordBreak,
      };
    });
    expect(geometry.fits).toBe(true);
    expect(geometry.height).toBeGreaterThanOrEqual(44);
    expect(geometry.height).toBeLessThanOrEqual(
      geometry.line * 2 + geometry.padding + 2,
    );
    expect(geometry.wordBreak).not.toBe("break-all");
    expect(geometry.wrap === "normal" || geometry.whiteSpace === "nowrap").toBe(
      true,
    );
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}

for (const theme of ["light", "dark"] as const) {
  test(`English: QR, подтверждение, повтор и личная посещаемость · ${theme}`, async ({
    page,
    browser,
    baseURL,
  }, info) => {
    test.skip(!process.env.DATABASE_URL, "Нужна БД лейна.");
    if (!baseURL) throw new Error("Нужен адрес приложения.");
    const f = await openAttendanceTestData();
    const context = await browser.newContext({
      baseURL,
      viewport:
        info.project.name === "mobile-360"
          ? { width: 360, height: 740 }
          : { width: 1440, height: 900 },
      isMobile: info.project.use.isMobile,
      reducedMotion: "reduce",
      colorScheme: theme,
      serviceWorkers: "block",
    });
    try {
      await context.addCookies([
        { name: "pulse-language", value: "en", url: baseURL },
      ]);
      await context.addInitScript(
        (value) => localStorage.setItem("pulse-theme", value),
        theme,
      );
      await loginAsTestTeacher(page, f.teacher.credentials);
      await page.goto(f.path);
      // A live GET proves the teacher screen has mounted before its first action.
      await page.waitForResponse(
        (response) =>
          response.url().endsWith(`${f.path}/live`) &&
          response.request().method() === "GET" &&
          response.ok(),
      );
      await page
        .getByRole("button", { name: "Открыть отметку", exact: true })
        .click();
      const link = page.getByTestId("attendance-link");
      await expect(link).toBeVisible();
      const student = await context.newPage();
      await student.goto("/login");
      await student
        .getByLabel("Username", { exact: true })
        .fill(f.student.credentials.login);
      await student
        .getByLabel("Password", { exact: true })
        .fill(f.student.credentials.password);
      await student
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
      await expect(student).toHaveURL(/\/today$/);
      const address = await link.getAttribute("href");
      if (!address) throw new Error("QR не выдан.");
      await student.goto(new URL(address).pathname);
      await expect(
        student.getByRole("heading", { name: "Class check-in", exact: true }),
      ).toBeVisible();
      await expect(
        student.getByRole("heading", { name: /^Check in for “/ }),
      ).toBeVisible();
      const button = student.getByRole("button", {
        name: "Check in",
        exact: true,
      });
      await expect(button).toHaveAttribute("data-attendance-ready", "true");
      expect(
        await f.teacher
          .sql`select id from attendance_records where student_id = ${f.student.actor.studentId}`,
      ).toHaveLength(0);
      await inspect(student);
      await button.click();
      await expect(
        student
          .getByRole("main")
          .getByRole("status")
          .filter({ hasText: "Checked in" }),
      ).toHaveText("Checked in ✓ · +1 activity point");
      await expect(student).toHaveURL(/\/attend$/);
      await expect(student.locator("html")).toHaveClass(new RegExp(theme));
      await expect(
        page.getByRole("status").filter({ hasText: "Отметились" }),
      ).toHaveText("Отметились 1 из 3");
      const current = await link.getAttribute("href");
      if (!current) throw new Error("QR не выдан.");
      await student.goto(new URL(current).pathname);
      await expect(
        student
          .getByRole("main")
          .getByText("You have already checked in", { exact: true }),
      ).toBeVisible();
      await expect(student).toHaveURL(/\/attend$/);
      await expect(button).toHaveCount(0);
      await student
        .getByRole("link", { name: "My attendance and points", exact: true })
        .click();
      await expect(student).toHaveURL(/\/grades#attendance$/);
      const summary = student.getByRole("region", {
        name: "Attendance and activity",
      });
      await expect(summary).toContainText("Attended 1 of 1 · 100%");
      await expect(summary).toContainText("1 of 20 — personal goal");
      await expect(summary).toContainText(
        "do not affect grades or your scholarship",
      );
      await expect(
        summary.getByRole("link", { name: "Why?", exact: true }),
      ).toHaveAttribute("href", "/regulations/attendance#p-5");
      await inspect(student);
      await student.screenshot({
        path: info.outputPath(`attendance-en-${theme}.png`),
        fullPage: true,
      });
      await student.goto(`/attend/${"x".repeat(22)}`);
      await expect(
        student
          .getByRole("main")
          .getByText("This code is invalid or has expired", { exact: true }),
      ).toBeVisible();
      await expect(student).toHaveURL(/\/attend$/);
      await expect(button).toHaveCount(0);
      await student.reload();
      await expect(student.getByRole("main")).toContainText(
        "open the current QR code",
      );
      await inspect(student);
      expect(
        await f.teacher
          .sql`select id from activity_points where student_id = ${f.student.actor.studentId}`,
      ).toHaveLength(1);
    } finally {
      await context.close();
      await f.close();
    }
  });
}
