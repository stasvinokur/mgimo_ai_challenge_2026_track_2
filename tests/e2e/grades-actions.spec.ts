import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresGradesRepository } from "@/infrastructure/db/repositories/grades/grades";
import {
  gradesActionDeadline,
  isolateGradesForTest,
} from "../integration/grades-actions-data";
import { expect, test } from "../security/student-login";

async function openDebt(page: Page, entry: "today" | "course") {
  if (entry === "today") {
    await page.goto("/today");
    const alert = page.getByTestId("today-action").filter({
      has: page.getByRole("heading", {
        name: "Основы маркетинга — есть долг",
        exact: true,
      }),
    });
    await alert.getByRole("link", { name: /^Что можно сделать\?/ }).click();
    await expect(page).toHaveURL(
      /\/grades\/[0-9a-f-]+\?actions=1#course-actions$/,
    );
  } else {
    await page.goto("/grades");
    await page
      .getByTestId("grade-course")
      .filter({
        has: page.getByRole("heading", {
          name: "Основы маркетинга",
          exact: true,
        }),
      })
      .getByRole("link", { name: /^Подробнее/ })
      .click();
    await expect(page).toHaveURL(/\/grades\/[0-9a-f-]+$/);
    await page.getByTestId("course-actions").locator("summary").click();
  }
  const plan = page.getByTestId("course-actions");
  await expect(plan).toHaveAttribute("open", "");
  await expect(plan).toContainText("Обязательная контрольная работа");
  await expect(plan).toContainText(/Срок .* МСК уже прошёл/);
  await expect(plan).toContainText("Что это даст:");
  await expect(plan).toContainText("без этой работы — 28,8");
  await expect(plan.locator("ol > li")).toHaveCount(2);
  return plan;
}

for (const entry of ["today", "course"] as const)
  test(`долг → варианты (${entry}) → правка обращения → проверка → отправка → трекер`, async ({
    page,
    loginAs,
    students,
  }) => {
    const student = await students.get("timur");
    if (student.actor.kind !== "student") throw new Error("Нужен студент.");
    const studentId = student.actor.studentId;
    const sql = createDatabase(1);
    async function requestCount() {
      const [row] = await sql<
        { total: number }[]
      >`select count(*)::int as total from requests where student_id = ${studentId}`;
      return row?.total;
    }
    try {
      const before = await requestCount();
      await loginAs("timur");
      const plan = await openDebt(page, entry);
      await plan
        .getByRole("link", { name: "Подготовить обращение", exact: true })
        .click();
      await expect(page).toHaveURL(
        /\/requests\/new\?type=question&courseId=[0-9a-f-]+&workId=[0-9a-f-]+$/,
      );
      await expect(
        page.getByRole("heading", { name: "Вопрос в деканат", exact: true }),
      ).toBeVisible();
      const input = page.getByLabel("Ваш вопрос (обязательно)", {
        exact: true,
      });
      await expect(input).toHaveValue(
        /^Вопрос по дисциплине «Основы маркетинга»/,
      );
      await expect(input).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect
        .poll(() => input.evaluate((element) => element.clientHeight))
        .toBeGreaterThan(0);
      await expect
        .poll(() =>
          input.evaluate(
            (element) => element.scrollHeight <= element.clientHeight,
          ),
        )
        .toBe(true);
      const text = await input.inputValue();
      expect(text).toContain("Работа: «Обязательная контрольная работа»");
      expect(text).toContain("Текущий итог без новых баллов: 28,8 из 100");
      expect(text).toMatch(/Срок: .* МСК/);
      expect(await requestCount()).toBe(before);
      await page.reload();
      await expect(input).toHaveValue(text);
      expect(await requestCount()).toBe(before);
      const edited = `${text}\nХочу уточнить доступное время консультации.`;
      await input.fill(edited);
      await expect
        .poll(() =>
          input.evaluate(
            (element) => element.scrollHeight <= element.clientHeight,
          ),
        )
        .toBe(true);
      await page
        .getByRole("button", { name: "Проверить заявку", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Проверьте заявку", exact: true }),
      ).toBeVisible();
      await expect(
        page.locator("dd").filter({ hasText: edited }),
      ).toBeVisible();
      expect(await requestCount()).toBe((before ?? 0) + 1);
      await page
        .getByRole("button", { name: "Подтвердить отправку", exact: true })
        .click();
      await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
      await expect(
        page.getByRole("heading", { name: "Путь заявки", exact: true }),
      ).toBeVisible();
      await expect(page.getByText("Подана", { exact: true })).toBeVisible();
      await expect(page.getByText(edited, { exact: true })).toBeVisible();
      expect(await requestCount()).toBe((before ?? 0) + 1);
    } finally {
      await sql.end({ timeout: 1 });
    }
  });

test("срок скоро на Сегодня передаёт выбранную работу в варианты и обращение", async ({
  page,
  loginAs,
}) => {
  await loginAs("timur");
  await page.goto("/today");
  const alert = page
    .getByTestId("today-action")
    .filter({ has: page.getByRole("heading", { name: /: Итоговый тест$/ }) });
  const link = alert.getByRole("link", { name: /^Что можно сделать\?/ });
  await expect(link).toHaveAttribute(
    "href",
    /workId=[0-9a-f-]+#course-actions$/,
  );
  await link.click();
  await expect(page).toHaveURL(/workId=[0-9a-f-]+#course-actions$/);
  const plan = page.getByTestId("course-actions");
  await expect(plan.locator("ol > li").first()).toContainText("Итоговый тест");
  await plan
    .getByRole("link", { name: "Подготовить обращение", exact: true })
    .click();
  await expect(page).toHaveURL(/\/requests\/new\?type=question&courseId=/);
  await expect(page.getByLabel("Ваш вопрос (обязательно)")).toHaveValue(
    /Работа: «Итоговый тест»/,
  );
});

test("Обсудить с ассистентом открывает единую шторку с вопросом и фактами", async ({
  page,
  loginAs,
}) => {
  const sent: { question: string }[] = [];
  await page.route("**/api/assistant", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({
      status: 503,
      json: { error: { code: "UNAVAILABLE", message: "Попробуйте позже." } },
    });
  });
  await loginAs("timur");
  const plan = await openDebt(page, "course");
  await plan
    .getByRole("button", { name: "Обсудить с ассистентом", exact: true })
    .click();
  const sheet = page.getByRole("dialog", {
    name: "Спросить или сделать",
    exact: true,
  });
  await expect(sheet).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(sheet.getByRole("log")).toContainText(
    "Что можно сделать по дисциплине «Основы маркетинга»?",
  );
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]?.question).toContain(
    "Работа: «Обязательная контрольная работа»",
  );
  expect(sent[0]?.question).toContain("28,8 из 100");
});

test("IDOR: Анна с courseId/workId Тимура получает ту же пустую форму, что с отсутствующим id", async ({
  page,
  loginAs,
  students,
  browser,
}) => {
  const sql = createDatabase(1);
  let isolated: Awaited<ReturnType<typeof isolateGradesForTest>> | undefined;
  try {
    const student = await students.get("timur");
    if (student.actor.kind !== "student") throw new Error("Нужен студент.");
    isolated = await isolateGradesForTest(student);
    const data = await new PostgresGradesRepository(() => sql).listForStudent(
      student.actor.studentId,
    );
    const foreign = data?.courses.find(
      (course) => course.title === "Основы маркетинга",
    );
    const work = foreign?.works.find((item) => item.score === null);
    if (!foreign || !work) throw new Error("Нужен сценарий долга.");
    const deadline = gradesActionDeadline(work.dueAt);
    const totalText = "28,8 из 100";
    const totalJson = '"total":28.8,';
    const totalHtml = JSON.stringify(totalJson).slice(1, -1);
    const deadlineTime = `${deadline.time} МСК`;
    const markers = [
      foreign.title,
      work.title,
      totalText,
      totalJson,
      totalHtml,
      work.dueAt,
      work.dueAt.slice(0, 10),
      deadline.label,
      deadline.date,
      deadlineTime,
    ];
    function expectNoForeignFacts(body: string) {
      for (const marker of markers) expect(body).not.toContain(marker);
    }
    async function readResponse(source: Page, path: string, rsc: boolean) {
      const response = await source.request.get(path, {
        headers: rsc ? { RSC: "1" } : {},
      });
      expect(response.status()).toBe(200);
      if (rsc)
        expect(response.headers()["content-type"]).toContain(
          "text/x-component",
        );
      return response.text();
    }
    const timurContext = await browser.newContext();
    try {
      const timurPage = await timurContext.newPage();
      await students.login(timurPage, "timur");
      for (const rsc of [false, true]) {
        const own = await readResponse(
          timurPage,
          `/requests/new?type=question&courseId=${foreign.id}&workId=${work.id}`,
          rsc,
        );
        for (const marker of [
          work.title,
          totalText,
          deadline.label,
          deadline.date,
          deadlineTime,
        ])
          expect(own).toContain(marker);
        const ownCourse = await readResponse(
          timurPage,
          `/grades/${foreign.id}?actions=1&workId=${work.id}`,
          rsc,
        );
        expect(ownCourse).toContain(rsc ? totalJson : totalHtml);
      }
    } finally {
      await timurContext.close();
    }
    await loginAs("anna");
    const anna = await students.get("anna");
    if (anna.actor.kind !== "student") throw new Error("Нужен студент.");
    const own = (
      await new PostgresGradesRepository(() => sql).listForStudent(
        anna.actor.studentId,
      )
    )?.courses.find((course) => course.title === "Иностранный язык");
    if (!own) throw new Error("Нужна дисциплина Анны.");
    for (const query of [
      `courseId=${foreign.id}`,
      `courseId=${foreign.id}&workId=${work.id}`,
      "courseId=00000000-0000-7000-8000-000000ffffee",
      "courseId=invalid",
      `courseId=${foreign.id}&courseId=00000000-0000-7000-8000-000000ffffee`,
      `courseId=${own.id}&workId=${work.id}`,
    ]) {
      const path = `/requests/new?type=question&${query}`;
      for (const rsc of [false, true])
        expectNoForeignFacts(await readResponse(page, path, rsc));
      await page.goto(path);
      await expect(page.getByLabel("Ваш вопрос (обязательно)")).toHaveValue("");
    }
    for (const workQuery of [
      `workId=${work.id}`,
      "workId=abc",
      "workId=00000000-0000-7000-8000-000000ffffee",
      `workId=${work.id}&workId=abc`,
    ]) {
      const path = `/grades/${own.id}?actions=1&${workQuery}`;
      for (const rsc of [false, true])
        expectNoForeignFacts(await readResponse(page, path, rsc));
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(
        page.getByRole("heading", { level: 1, name: own.title, exact: true }),
      ).toBeVisible();
      await expect(page.getByTestId("course-actions")).toHaveAttribute(
        "open",
        "",
      );
      await expect(page.getByTestId("course-actions")).toContainText(
        "Итоговый тест",
      );
    }
    for (const id of [foreign.id, "00000000-0000-7000-8000-000000ffffee"]) {
      const path = `/grades/${id}?actions=1&workId=${work.id}`;
      const denied = await page.request.get(path);
      expect(denied.status()).toBe(404);
      expectNoForeignFacts(await denied.text());
      const flight = await page.request.get(path, { headers: { RSC: "1" } });
      const body = await flight.text();
      expect(flight.headers()["content-type"]).toContain("text/x-component");
      expect(body).toContain("NEXT_HTTP_ERROR_FALLBACK;404");
      expectNoForeignFacts(body);
    }
  } finally {
    try {
      await isolated?.close();
    } finally {
      await sql.end({ timeout: 1 });
    }
  }
});

test("обычная пустая форма вопроса сохраняет прежнюю высоту", async ({
  page,
  loginAs,
}) => {
  await loginAs("anna");
  await page.goto("/requests/new?type=question");
  const input = page.getByLabel("Ваш вопрос (обязательно)", { exact: true });
  await expect(input).toBeVisible();
  await expect(input).toHaveValue("");
  await expect(input).toHaveAttribute("rows", "5");
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() => input.evaluate((element) => element.clientHeight))
    .toBeGreaterThan(0);
  const height = await input.evaluate((element) => element.clientHeight);
  await input.fill("Уточнение к вопросу. ".repeat(80));
  await expect
    .poll(() => input.evaluate((element) => element.clientHeight))
    .toBe(height);
  expect(
    await input.evaluate((element) => element.scrollHeight),
  ).toBeGreaterThan(height);
});

for (const theme of ["light", "dark"] as const)
  test(`варианты и предзаполнение: axe, ширина, переносы слов · ${theme}`, async ({
    page,
    loginAs,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("pulse-theme", value),
      theme,
    );
    await loginAs("timur");
    const plan = await openDebt(page, "today");
    for (const screen of ["options", "form", "review"] as const) {
      if (screen === "form") {
        await plan
          .getByRole("link", { name: "Подготовить обращение", exact: true })
          .click();
        await expect(page).toHaveURL(
          /\/requests\/new\?type=question&courseId=/,
        );
      }
      if (screen === "review") {
        await page
          .getByRole("button", { name: "Проверить заявку", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "Проверьте заявку", exact: true }),
        ).toBeVisible();
      }
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      const buttons =
        screen === "options"
          ? plan.locator("a, button")
          : page.locator('main [data-slot="button"]');
      for (const button of await buttons.all()) {
        const dimensions = await button.evaluate((element) => {
          const style = getComputedStyle(element);
          const box = element.getBoundingClientRect();
          return {
            width: box.width,
            height: box.height,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            line: Number.parseFloat(style.lineHeight),
            padding:
              Number.parseFloat(style.paddingTop) +
              Number.parseFloat(style.paddingBottom),
            wrap: style.overflowWrap,
            whitespace: style.whiteSpace,
          };
        });
        expect(dimensions.width).toBeGreaterThanOrEqual(44);
        expect(dimensions.height).toBeGreaterThanOrEqual(44);
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(
          dimensions.clientWidth,
        );
        expect(dimensions.height).toBeLessThanOrEqual(
          dimensions.line * 2 + dimensions.padding + 2,
        );
        expect(
          dimensions.wrap === "normal" || dimensions.whitespace === "nowrap",
        ).toBe(true);
      }
    }
  });
