import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { createDatabase } from "@/infrastructure/db/client";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { expect, test } from "../security/student-login";

async function inspectScreen(
  page: Page,
  info: TestInfo,
  name: string,
  actions?: Locator,
) {
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  for (const control of actions
    ? await actions.locator("a:visible, button:visible").all()
    : []) {
    await expect(control).toBeVisible();
    const dimensions = await control.evaluate((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        line: Number.parseFloat(style.lineHeight),
        padding:
          Number.parseFloat(style.paddingTop) +
          Number.parseFloat(style.paddingBottom),
        wrap: style.overflowWrap,
        whitespace: style.whiteSpace,
        wordBreak: style.wordBreak,
      };
    });
    expect(dimensions.width).toBeGreaterThanOrEqual(44);
    expect(dimensions.height).toBeGreaterThanOrEqual(44);
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
    expect(dimensions.height).toBeLessThanOrEqual(
      dimensions.line * 2 + dimensions.padding + 2,
    );
    expect(dimensions.wordBreak).not.toBe("break-all");
    expect(
      dimensions.wrap === "normal" || dimensions.whitespace === "nowrap",
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

for (const theme of ["light", "dark"] as const) {
  test(`English: долг Тимура, варианты и пометка о русском обращении · ${theme}`, async ({
    page,
    loginAs,
    baseURL,
  }, info) => {
    const sent: { question: string }[] = [];
    await page.route("**/api/assistant", async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({
        status: 503,
        json: {
          error: { code: "UNAVAILABLE", message: "Please try again later." },
        },
      });
    });
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
    await page
      .context()
      .addCookies([
        { name: "pulse-language", value: "en", url: baseURL ?? page.url() },
      ]);
    await page.goto("/grades");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    await expect(
      page.getByRole("heading", { level: 1, name: "Study", exact: true }),
    ).toBeVisible();
    const card = page.getByTestId("grade-course").first();
    await expect(card.getByRole("heading")).toHaveText("Основы маркетинга");
    await expect(card).toContainText("Outstanding work");
    await expect(card).toContainText("28.8");
    const forecast = page.getByTestId("scholarship-forecast");
    await expect(forecast.getByTestId("scholarship-headline")).toContainText(
      "No scholarship yet: there is an outstanding requirement",
    );
    await expect(forecast).toContainText("Основы маркетинга");
    await inspectScreen(page, info, `grades-en-timur-list-${theme}`);
    await card.locator('a[href^="/grades/"]').click();
    await expect(page).toHaveURL(/\/grades\/[0-9a-f-]+$/);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Основы маркетинга",
        exact: true,
      }),
    ).toBeVisible();
    const plan = page.getByTestId("course-actions");
    await expect(plan).toHaveAttribute("data-course-actions-ready", "true");
    await expect(plan.locator("summary")).toContainText("What can I do?");
    await plan.locator("summary").click();
    await expect(plan).toHaveAttribute("open", "");
    await expect(plan).toContainText("Обязательная контрольная работа");
    await expect(plan).toContainText("28.8");
    await expect(plan).toContainText(
      "The enquiry sent to the dean’s office is in Russian. You can edit it before sending.",
    );
    await expect(
      plan.getByRole("link", { name: "Prepare an enquiry", exact: true }),
    ).toHaveAttribute(
      "href",
      /\/requests\/new\?type=question&courseId=[0-9a-f-]+&workId=[0-9a-f-]+$/,
    );
    await expect(
      plan.getByRole("button", {
        name: "Discuss with the assistant",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Works and deadlines", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Score history", exact: true }),
    ).toBeVisible();
    await inspectScreen(page, info, `grades-en-timur-actions-${theme}`, plan);
    await plan
      .getByRole("button", {
        name: "Discuss with the assistant",
        exact: true,
      })
      .click();
    const conversation = page.getByRole("dialog").getByRole("log");
    await expect(conversation).toBeVisible();
    await expect(conversation).toContainText(
      "What can I do for the course «Основы маркетинга»?",
    );
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]?.question).toContain(
      "Assignment: «Обязательная контрольная работа»",
    );
    expect(sent[0]?.question).toContain(
      "Current total without new scores: 28.8 out of 100.",
    );
    expect(sent[0]?.question).toContain("The deadline has passed.");
    expect(sent[0]?.question).not.toContain("Что можно сделать");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("link", { name: "All courses", exact: true }).click();
    await expect(page).toHaveURL(/\/grades$/);
  });

  test(`English: история переводит коды причин и московскую дату · ${theme}`, async ({
    page,
    loginAs,
    students,
    baseURL,
  }, info) => {
    const student = await students.get("anna");
    if (student.actor.kind !== "student") throw new Error("Нужен студент.");
    const sql = createDatabase(1);
    const ids = new UuidV7Generator();
    const events = [
      { id: ids.next(), reason: "retake" },
      { id: ids.next(), reason: "unknown-private-text" },
    ];
    const eventIds = events.map((event) => event.id);
    const at = "2026-10-30T21:17:00.000Z";
    try {
      const [work] = await sql<
        { id: string; courseId: string; title: string; teacherUserId: string }[]
      >`select a.id, a.course_id as "courseId", a.title,
          (select id from users where login = 'oleg') as "teacherUserId"
        from assessments a
        join courses c on c.id = a.course_id
        join students s on s.group_id = a.group_id
        where s.id = ${student.actor.studentId} and c.title = 'Иностранный язык'
        order by a.id limit 1`;
      if (!work?.teacherUserId) throw new Error("Нужны учебные демо-данные.");
      for (const event of events) {
        await sql`insert into score_events
          (id, assessment_id, student_id, student_user_id, previous_score,
           new_score, changed_by_user_id, reason, created_at)
          values (${event.id}, ${work.id}, ${student.actor.studentId},
            ${student.actor.userId}, 80, 90, ${work.teacherUserId}, ${event.reason}, ${at}::timestamptz)`;
      }
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
      await page
        .context()
        .addCookies([
          { name: "pulse-language", value: "en", url: baseURL ?? page.url() },
        ]);
      await page.goto(`/grades/${work.courseId}`);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      const history = page.getByRole("region", {
        name: "Score history",
        exact: true,
      });
      await expect(history).toContainText(work.title);
      await expect(history).toContainText("80 → 90");
      await expect(history).toContainText("Retake");
      await expect(history).toContainText("Reason being clarified");
      await expect(history).not.toContainText("unknown-private-text");
      const date = new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Moscow",
      }).format(new Date(at));
      const times = history.locator(`time[datetime="${at}"]`);
      await expect(times).toHaveCount(2);
      for (const time of await times.all()) await expect(time).toHaveText(date);
      const response = await page.request.get(
        `/grades/${work.courseId}/history`,
      );
      expect(response.status()).toBe(200);
      const dto = await response.json();
      expect(
        dto.entries.map((entry: { reason: string }) => entry.reason),
      ).toEqual(expect.arrayContaining(["retake", "clarification"]));
      expect(JSON.stringify(dto)).not.toContain("unknown-private-text");
      await inspectScreen(page, info, `grades-en-history-${theme}`);
    } finally {
      try {
        await sql`delete from score_events where student_id = ${student.actor.studentId} and id in ${sql(eventIds)}`;
      } finally {
        await sql.end({ timeout: 1 });
      }
    }
  });
}
