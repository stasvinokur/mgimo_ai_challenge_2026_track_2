import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type Locator, mergeTests, type Page } from "@playwright/test";
import { addDays, atMoscow, moscowDate } from "@/domain/schedule/dates";
import { createDatabase } from "@/infrastructure/db/client";
import { PAGE_CACHE_PREFIX } from "@/ui/shell/pwa-cache";
import {
  attendanceServices,
  openAttendanceTestData,
} from "../integration/attendance-data";
import { readDemoAccountCounts } from "../integration/demo-account-counts";
import { openPickupFixture } from "../integration/pickup-data";
import { openEventRequestFixture } from "../integration/requests-event-data";
import { openStudentTestData } from "../integration/student-e2e-data";
import { openTeacherGradesTestData } from "../integration/teacher-grades-data";
import { test as assistantTest } from "../security/assistant-fixture";
import { test as certificatesTest } from "../security/certificates-fixture";
import { loginAs } from "../security/login";
import { registerKey } from "../security/passkey-fixture";
import { loginAsTestStaff } from "../security/staff-login";
import { loginAsTestStudent } from "../security/student-login";
import { loginAsTestTeacher } from "../security/teacher-login";
import { attachCertificatePdfScreenshot } from "./certificates-pdf-screenshot";
import { captureScreenshot } from "./screenshot";
import { installTodaySpeech } from "./today-speech";

const test = mergeTests(assistantTest, certificatesTest).extend<{
  demoCounts: undefined;
}>({
  demoCounts: [
    async ({ baseURL }, use) => {
      expect(baseURL, "Нужен адрес production-сборки.").toBeTruthy();
      expect(
        Boolean(process.env.DATABASE_URL),
        "Нужна БД той же сборки для временных фикстур и контроля демо-данных.",
      ).toBe(true);
      const sql = createDatabase(1);
      try {
        const before = await readDemoAccountCounts(sql);
        expect(before).toHaveLength(3);
        try {
          await use(undefined);
        } finally {
          expect(await readDemoAccountCounts(sql)).toEqual(before);
        }
      } finally {
        await sql.end({ timeout: 1 });
      }
    },
    { auto: true },
  ],
});

type Theme = "light" | "dark";

const attendanceNames = {
  teacherName: "Лев Аркадьевич Зорин",
  groupTitle: "ФМО-22-Г",
  studentNames: [
    "Нина Алексеевна Ладова",
    "Артём Игоревич Берестов",
    "Вера Павловна Кленова",
  ] as const,
};
const eventName = "Межвузовский хакатон «Горизонт»";

async function capture(
  page: Page,
  name: string,
  theme: Theme,
  loading = false,
  themed = true,
) {
  const viewport = page.viewportSize();
  const width = viewport?.width;
  expect([360, 1440]).toContain(width);
  expect(viewport?.height).toBe(width === 360 ? 740 : 900);
  // The public certificate check is a standalone page with one light style, not the cabinet theme.
  if (themed) await expect(page.locator("html")).toHaveClass(new RegExp(theme));
  if (!loading)
    await expect(
      page.locator('div[hidden][id^="S:"]'),
      "Скрытая потоковая копия — дефект продукта (история 39), её нельзя прятать в галерее.",
    ).toHaveCount(0);
  const path = resolve(
    "docs/screenshots/gallery",
    `${name}-${width}-${theme}.png`,
  );
  const dialog = page.getByRole("dialog");
  const modal = (await dialog.count()) > 0;
  if (modal)
    await expect
      .poll(() =>
        dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      )
      .toBe(true);
  await captureScreenshot(page, path, {
    heading: !loading && !modal,
    tags: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
  });
  const png = await readFile(path);
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([
    width,
    viewport?.height,
  ]);
}

async function top(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
}

async function position(locator: Locator) {
  await expect(locator).toBeVisible();
  await locator.evaluate((element) =>
    element.scrollIntoView({ block: "start", behavior: "instant" }),
  );
  await expect(locator).toBeInViewport();
}

async function open(page: Page, path: string, title: string) {
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: title, exact: true }),
  ).toBeVisible();
  await top(page);
}

async function hydrated(locator: Locator) {
  await expect
    .poll(() =>
      locator.evaluate((element) =>
        Object.keys(element).some((key) => key.startsWith("__reactFiber")),
      ),
    )
    .toBe(true);
}

function pageRecord(body: string, title: string) {
  function hasHeading(value: unknown): boolean {
    if (!Array.isArray(value)) {
      return (
        value !== null &&
        typeof value === "object" &&
        Object.values(value).some(hasHeading)
      );
    }
    return (
      (value[0] === "$" && value[1] === "h1" && value[3]?.children === title) ||
      value.some(hasHeading)
    );
  }
  const records = body.split("\n").filter((line) => {
    const match = /^([0-9a-f]+):(\[.*)$/u.exec(line);
    if (!match || match[1] === "0") return false;
    return hasHeading(JSON.parse(match[2] ?? "null"));
  });
  expect(
    records,
    "Нужен единственный RSC-результат страницы, а не layout.",
  ).toHaveLength(1);
  const record = records[0];
  if (!record) throw new Error("Не найден RSC-результат страницы.");
  return { record, id: record.slice(0, record.indexOf(":")) };
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`Галерея · ${theme}`, () => {
    test.beforeEach(async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.addInitScript(
        ({ theme, hideInstall }) => {
          localStorage.setItem("pulse-theme", theme);
          if (hideInstall) localStorage.setItem("pulse-install-dismissed", "1");
        },
        { theme, hideInstall: !info.title.includes("подсказка установки") },
      );
    });

    test("вход, все разделы студента, пустое состояние и долг", async ({
      page,
    }) => {
      await open(page, "/login", "Вход в «Пульс»");
      await capture(page, "login-default", theme);
      await loginAs(page, "anna");
      await open(page, "/today", "Сегодня");
      await expect(
        page.getByRole("heading", { name: "Сейчас", exact: true }),
      ).toBeVisible();
      await capture(page, "today-default", theme);
      await position(
        page.getByRole("heading", { name: "Требует действия", exact: true }),
      );
      await capture(page, "today-actions", theme);
      await position(
        page.getByRole("heading", { name: "Что дальше", exact: true }),
      );
      await capture(page, "today-next", theme);
      for (const view of ["today", "week"] as const) {
        await open(page, `/schedule?view=${view}`, "Расписание");
        await capture(page, `schedule-${view}`, theme);
        await position(page.locator('[data-slot="card-title"] h2').first());
        await capture(page, `schedule-${view}-lessons`, theme);
      }
      await open(page, "/grades", "Учёба");
      await expect(page.getByTestId("scholarship-forecast")).toContainText(
        "не меньше 77 из 100",
      );
      await capture(page, "grades-default", theme);
      const course = page.getByTestId("grade-course").first();
      await position(course);
      await capture(page, "grades-courses", theme);
      await course.getByRole("link", { name: /Подробнее/ }).click();
      await expect(page).toHaveURL(/\/grades\/[0-9a-f-]+$/);
      await expect(page.getByRole("slider")).toHaveValue("77");
      await top(page);
      await capture(page, "grades-course", theme);
      await position(
        page.getByRole("region", { name: "Что если?", exact: true }),
      );
      await capture(page, "grades-what-if", theme);
      await position(page.getByTestId("scholarship-forecast"));
      await capture(page, "grades-scholarship", theme);
      for (const [path, title, name] of [
        ["/requests", "Заявки", "requests-list"],
        ["/requests/new", "Новая заявка", "requests-catalog"],
        ["/requests/new?type=enrollment", "Новая заявка", "requests-form"],
        ["/notifications", "Уведомления", "notifications-default"],
        ["/profile", "Профиль", "profile-default"],
        ["/regulations", "Положения деканата", "regulations-list"],
        ["/regulations/scholarship", "Стипендии", "regulations-document"],
      ] as const) {
        await open(page, path, title);
        await capture(page, name, theme);
        if (name === "requests-form") {
          await position(page.getByLabel("Место требования (обязательно)"));
          await capture(page, "requests-form-fields", theme);
        }
      }
      await open(page, "/requests", "Заявки");
      await page
        .locator("li")
        .filter({ has: page.getByText("Готова", { exact: true }) })
        .first()
        .getByRole("link", { name: "Отследить заявку" })
        .click();
      await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
      await expect(page.locator("[aria-current=step]")).toContainText("Готова");
      await top(page);
      await capture(page, "requests-tracker", theme);
      await position(
        page.getByRole("heading", { name: "Путь заявки", exact: true }),
      );
      await capture(page, "requests-timeline", theme);

      await loginAs(page, "timur");
      await open(page, "/requests", "Заявки");
      await expect(
        page.getByRole("heading", { name: "Заявок пока нет", exact: true }),
      ).toBeVisible();
      await capture(page, "requests-empty", theme);
      await open(page, "/today", "Сегодня");
      const debt = page.getByTestId("today-action").first();
      await expect(debt).toContainText("Основы маркетинга — есть долг");
      await capture(page, "today-timur", theme);
      await position(debt);
      await capture(page, "today-debt-alert", theme);

      await loginAs(page, "marina");
      await open(page, "/staff/requests", "Заявки студентов");
      await capture(page, "staff-board", theme);
      const board =
        page.viewportSize()?.width === 360
          ? page.getByRole("navigation", { name: "Статусы заявок" })
          : page.locator("[data-column=submitted]");
      await position(board);
      await capture(page, "staff-kanban", theme);
      const request = page
        .getByRole("link", { name: /^Открыть заявку/ })
        .filter({ visible: true })
        .first();
      await request.click();
      await expect(page).toHaveURL(/\/staff\/requests\/[0-9a-f-]+$/);
      await expect(
        page.getByRole("main").getByRole("heading", { level: 1 }),
      ).toBeVisible();
      await top(page);
      await capture(page, "staff-request", theme);
      await position(page.getByRole("region", { name: "Действия сотрудника" }));
      await capture(page, "staff-actions", theme);
      await open(page, "/staff/profile", "Профиль сотрудника");
      await capture(page, "staff-profile", theme);
    });

    test("преподаватель: сегодня, неделя, QR, состав; отметка и личная активность", async ({
      page,
      browser,
      baseURL,
    }, info) => {
      const f = await openAttendanceTestData({
        ...attendanceNames,
        lessonTime: "around-now",
      });
      const studentContext = await browser
        .newContext({
          baseURL,
          viewport: page.viewportSize() ?? undefined,
          isMobile: info.project.use.isMobile,
          hasTouch: info.project.use.hasTouch,
          deviceScaleFactor: 1,
          locale: "ru-RU",
          timezoneId: "Europe/Moscow",
          colorScheme: theme,
          reducedMotion: "reduce",
          serviceWorkers: "block",
        })
        .catch(async (error) => {
          await f.close();
          throw error;
        });
      try {
        const records = attendanceServices(f, {
          now: () => new Date(),
        }).records;
        const excuse = {
          sourceKey: `gallery:${f.teacher.slotId}`,
          reason: eventName,
          markedAt: new Date().toISOString(),
        };
        await records.markExcusedForStudent(
          f.excused.actor.studentId,
          f.key,
          excuse,
        );
        await records.markExcusedForStudent(
          f.student.actor.studentId,
          { ...f.key, occurrenceDate: addDays(f.key.occurrenceDate, -7) },
          excuse,
        );
        await studentContext.addInitScript((value) => {
          localStorage.setItem("pulse-theme", value);
          localStorage.setItem("pulse-install-dismissed", "1");
        }, theme);
        const student = await studentContext.newPage();
        await loginAsTestStudent(student, f.student.credentials);
        await loginAsTestTeacher(page, f.teacher.credentials);
        await expect(
          page.getByRole("heading", { name: "Мои пары", exact: true }),
        ).toBeVisible();
        const time = new Intl.DateTimeFormat("ru-RU", {
          timeZone: "Europe/Moscow",
          hour: "2-digit",
          minute: "2-digit",
        });
        const interval = `${time.format(new Date(f.lessonTime.startsAt))}–${time.format(new Date(f.lessonTime.endsAt))}`;
        await expect(page.getByTestId("teacher-lesson").first()).toContainText(
          interval,
        );
        await top(page);
        await capture(page, "teacher-today", theme);
        await position(
          page.getByRole("heading", { name: "На этой неделе", exact: true }),
        );
        await capture(page, "teacher-week", theme);
        await page
          .getByRole("link", { name: "Открыть отметку", exact: true })
          .first()
          .click();
        await expect(page).toHaveURL(new RegExp(`${f.path}$`));
        const start = page.getByRole("button", {
          name: "Открыть отметку",
          exact: true,
        });
        await hydrated(start);
        await start.click();
        const link = page.getByTestId("attendance-link");
        const qr = page.getByRole("img", { name: /^QR-код/ });
        const counter = page
          .getByRole("status")
          .filter({ hasText: "Отметились" });
        await expect(link).toBeVisible();
        await expect(qr).toBeVisible();
        await expect(counter).toHaveText("Отметились 0 из 3");
        const first = await link.getAttribute("href");
        await expect
          .poll(() => link.getAttribute("href"), { timeout: 26000 })
          .not.toBe(first);
        const address = await link.getAttribute("href");
        if (!address) throw new Error("Не выдан QR для временной пары.");
        await open(student, new URL(address).pathname, "Отметка на паре");
        await expect(
          student.getByRole("heading", { name: /^Отметиться на паре «/ }),
        ).toBeVisible();
        const mark = student.getByRole("button", {
          name: "Отметиться",
          exact: true,
        });
        await hydrated(mark);
        await capture(student, "attendance-confirmation", theme);
        await mark.click();
        await expect(student.getByRole("status")).toHaveText(
          "Отмечено ✓ · +1 балл активности",
        );
        await expect(student).toHaveURL(/\/attend$/);
        await capture(student, "attendance-result", theme);
        await expect(counter).toHaveText("Отметились 1 из 3");
        await position(
          page.getByRole("heading", { name: "Экран аудитории", exact: true }),
        );
        const previous = await link.getAttribute("href");
        await expect
          .poll(() => link.getAttribute("href"), { timeout: 26000 })
          .not.toBe(previous);
        await expect(qr).toBeVisible();
        await expect(qr).toHaveJSProperty("complete", true);
        await expect
          .poll(() =>
            qr.evaluate(
              (element) => (element as HTMLImageElement).naturalWidth,
            ),
          )
          .toBeGreaterThan(0);
        const photographed = await link.getAttribute("href");
        await capture(page, "teacher-classroom", theme);
        expect(
          await link.getAttribute("href"),
          "QR не меняется во время снимка.",
        ).toBe(photographed);
        await page
          .getByRole("button", { name: "Закрыть отметку", exact: true })
          .click();
        await expect(link).toHaveCount(0);
        await expect(
          page.getByText("Отметка закрыта.", { exact: false }),
        ).toBeVisible();
        const roster = page.getByTestId("attendance-roster");
        await roster.locator("summary").click();
        await expect(roster).toHaveJSProperty("open", true);
        await expect(roster.getByText("Был", { exact: true })).toBeVisible();
        await expect(
          roster.getByText(`Уважительная причина: ${eventName}`, {
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          roster.getByText("Не отмечен", { exact: true }),
        ).toBeVisible();
        for (const name of attendanceNames.studentNames)
          await expect(roster).toContainText(name);
        await position(roster);
        await capture(page, "teacher-roster", theme);
        await student
          .getByRole("link", { name: "Моя посещаемость и баллы", exact: true })
          .click();
        await expect(student).toHaveURL(/\/grades#attendance$/);
        const attendance = student.getByRole("region", {
          name: "Посещаемость и активность",
          exact: true,
        });
        await expect(attendance).toContainText("Был на 1 из 1 · 100%");
        await expect(attendance).toContainText(
          "Уважительные причины: 1. Не входят в расчёт процента.",
        );
        await position(attendance);
        await capture(student, "grades-attendance", theme);
        await expect(attendance).toContainText("1 из 20 — личная цель");
        await position(
          attendance.getByRole("heading", {
            name: "Мои баллы активности",
            exact: true,
          }),
        );
        await capture(student, "grades-activity", theme);
      } finally {
        try {
          await studentContext.close();
          await page.close();
        } finally {
          await f.close();
        }
      }
    });

    test("освобождение: форма, пары, карточка сотрудника и уважительная посещаемость", async ({
      page,
    }) => {
      const attendance = await openAttendanceTestData({
        ...attendanceNames,
        lessonTime: "around-now",
      });
      const f = await openEventRequestFixture().catch(async (error) => {
        await attendance.close();
        throw error;
      });
      try {
        if (f.anna.kind !== "student")
          throw new Error("Нужен временный студент.");
        await f.sql`update students set full_name = ${attendanceNames.studentNames[0]}, group_id = ${attendance.teacher.groupId} where id = ${f.anna.studentId}`;
        await f.sql`update staff set full_name = 'Таисия Сергеевна Рощина' where id = ${f.limited.staffId}`;
        const payload = {
          eventName,
          organizer: "Межвузовская лаборатория проектов",
          dateFrom: attendance.key.occurrenceDate,
          dateTo: attendance.key.occurrenceDate,
          eventFormat: "Очное участие в команде",
          confirmation:
            "Приглашение участника: команда «Север», трек цифровых сервисов.",
        };
        await loginAsTestStudent(page, f.studentCredentials.anna);
        await open(page, "/requests/new?type=event_release", "Новая заявка");
        for (const [label, value] of [
          ["Название мероприятия", payload.eventName],
          ["Организатор", payload.organizer],
          ["Дата с", payload.dateFrom],
          ["Дата по", payload.dateTo],
          ["Формат участия", payload.eventFormat],
          ["Подтверждение: ссылка или текст приглашения", payload.confirmation],
        ])
          await page
            .getByLabel(`${label} (обязательно)`, { exact: true })
            .fill(value ?? "");
        const review = page.getByRole("button", {
          name: "Проверить заявку",
          exact: true,
        });
        await hydrated(review);
        await position(
          page.getByLabel("Название мероприятия (обязательно)", {
            exact: true,
          }),
        );
        await capture(page, "requests-event-form", theme);
        await review.click();
        const lessons = page.getByRole("heading", {
          name: "Пары на время мероприятия",
          exact: true,
        });
        await expect(lessons).toBeVisible();
        const list = lessons.locator("..");
        await expect(list.locator("li")).toHaveCount(1);
        const lessonText = new Intl.DateTimeFormat("ru-RU", {
          timeZone: "Europe/Moscow",
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(attendance.lessonTime.startsAt));
        await expect(list).toContainText(lessonText);
        const course = await list.locator("li p").first().textContent();
        if (!course) throw new Error("В списке освобождения нет дисциплины.");
        await position(lessons);
        await capture(page, "requests-event-lessons", theme);
        await page
          .getByRole("button", { name: "Подтвердить отправку", exact: true })
          .click();
        await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
        const path = new URL(page.url()).pathname;
        await expect(page.locator("[aria-current=step]")).toContainText(
          "Подана",
        );
        await loginAsTestStaff(page, f.limitedCredentials);
        const response = await page.goto(`/staff${path}`);
        expect(response?.status()).toBe(200);
        await expect(
          page.getByRole("main").getByRole("heading", { level: 1 }),
        ).toBeVisible();
        await expect(page.getByRole("main")).toContainText(eventName);
        await top(page);
        await capture(page, "staff-event-request", theme);
        const staffLessons = page.getByRole("heading", {
          name: "Пары на время мероприятия",
          exact: true,
        });
        await expect(staffLessons.locator("..")).toContainText(course);
        await expect(staffLessons.locator("..")).toContainText(lessonText);
        await position(staffLessons);
        await capture(page, "staff-event-lessons", theme);
        for (const [button, status] of [
          ["Принять", "Принята"],
          ["В работу", "В работе"],
          ["Готова", "Готова"],
        ] as const) {
          await page.getByRole("button", { name: button, exact: true }).click();
          await expect(
            page
              .locator('[data-slot="badge"]')
              .filter({ hasText: new RegExp(`^${status}$`) })
              .first(),
          ).toBeVisible();
        }
        await loginAsTestStudent(page, f.studentCredentials.anna);
        await open(page, "/grades#attendance", "Учёба");
        const summary = page.getByRole("region", {
          name: "Посещаемость и активность",
          exact: true,
        });
        await expect(summary).toContainText(
          "Уважительные причины: 1. Не входят в расчёт процента.",
        );
        await expect(summary).toContainText("5 из 20 — личная цель");
        await position(summary);
        await capture(page, "grades-event-excused", theme);
      } finally {
        try {
          await page.close();
        } finally {
          try {
            await f.close();
          } finally {
            await attendance.close();
          }
        }
      }
    });

    test("долг: что можно сделать и предзаполненное обращение", async ({
      page,
    }) => {
      const student = await openStudentTestData("timur");
      try {
        await loginAsTestStudent(page, student.credentials);
        await open(page, "/today", "Сегодня");
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
        const plan = page.getByTestId("course-actions");
        await expect(plan).toHaveAttribute("open", "");
        await expect(plan.locator("ol > li")).toHaveCount(2);
        await expect(plan).toContainText("Обязательная контрольная работа");
        await position(plan);
        await capture(page, "grades-actions", theme);
        await plan
          .getByRole("link", { name: "Подготовить обращение", exact: true })
          .click();
        await expect(page).toHaveURL(
          /\/requests\/new\?type=question&courseId=[0-9a-f-]+&workId=[0-9a-f-]+$/,
        );
        const input = page.getByLabel("Ваш вопрос (обязательно)", {
          exact: true,
        });
        await expect(input).toBeVisible();
        await expect(input).toHaveValue(
          /^Вопрос по дисциплине «Основы маркетинга»/,
        );
        await expect
          .poll(() =>
            input.evaluate(
              (element) => element.scrollHeight <= element.clientHeight,
            ),
          )
          .toBe(true);
        await position(input);
        await capture(page, "requests-question-prefilled", theme);
      } finally {
        try {
          await page.close();
        } finally {
          await student.close();
        }
      }
    });

    test("журнал ассистента: пусто, ответ с источником, черновик и решение", async ({
      page,
      loginStudent,
    }) => {
      expect(
        process.env.ASSISTANT_RUNTIME,
        "Запустите production-сервер и галерею с ASSISTANT_RUNTIME=mock.",
      ).toBe("mock");
      await loginStudent();
      await open(page, "/profile/assistant", "Мой журнал ассистента");
      await expect(
        page.getByRole("heading", { name: "Пока нет записей", exact: true }),
      ).toBeVisible();
      await capture(page, "assistant-journal-empty", theme);

      const sheet = page.getByRole("dialog", { name: "Спросить или сделать" });
      const trigger = page.getByRole("button", {
        name: "Спросить или сделать",
        exact: true,
      });
      const entries = page
        .getByRole("region", { name: "Последние обращения", exact: true })
        .locator(":scope > ol > li");
      async function refreshJournal(question: string, outcome: string) {
        const entry = entries.filter({ hasText: question });
        await expect(async () => {
          if (!(await sheet.isVisible())) {
            await hydrated(trigger);
            await trigger.click();
            await expect(sheet).toBeVisible();
          }
          await sheet
            .getByRole("link", { name: "Мой журнал", exact: true })
            .click();
          await expect(page).toHaveURL(/\/profile\/assistant$/);
          await expect(sheet).not.toBeVisible();
          await expect(entry).toContainText(outcome, { timeout: 1000 });
        }).toPass({ timeout: 15000 });
        return entry;
      }

      await hydrated(trigger);
      await trigger.click();
      await expect(sheet).toBeVisible();
      const answerQuestion = "Повышенная стипендия";
      await sheet.getByLabel("Ваш вопрос").fill(answerQuestion);
      await sheet
        .getByRole("button", { name: "Задать вопрос", exact: true })
        .click();
      const log = sheet.getByRole("log");
      await expect(log).toContainText("Проверьте сведения и источники ниже");
      await expect(log.getByRole("status")).toHaveCount(0);
      const answer = await refreshJournal(answerQuestion, "Ответил");
      await expect(
        answer.locator('a[href="/regulations/scholarship#p-2"]'),
      ).toBeVisible();
      await position(answer);
      await capture(page, "assistant-journal-answer", theme);

      await trigger.click();
      await expect(sheet).toBeVisible();
      const draftQuestion =
        "Как получить справку для работодателя? Получатель — работодателя";
      await sheet.getByLabel("Ваш вопрос").fill(draftQuestion);
      await sheet
        .getByRole("button", { name: "Задать вопрос", exact: true })
        .click();
      const confirmation = sheet.getByRole("button", {
        name: "Подтвердить отправку",
        exact: true,
      });
      await expect(confirmation).toBeEnabled();
      await expect(
        log.getByText("Думаю… Ответ может занять некоторое время."),
      ).not.toBeVisible();
      const draft = await refreshJournal(draftQuestion, "Подготовил черновик");
      await expect(
        draft.locator('a[href="/regulations/certificates#p-3-2"]'),
      ).toBeVisible();
      await position(draft);
      await capture(page, "assistant-journal-draft", theme);

      // The shell owns the conversation; closing the sheet and router.refresh preserve it.
      await trigger.click();
      await expect(sheet).toBeVisible();
      await expect(confirmation).toBeEnabled();
      await confirmation.click();
      await expect(
        sheet.getByRole("link", { name: /^Открыть заявку/ }),
      ).toBeVisible();
      await expect(
        log.getByText("Думаю… Ответ может занять некоторое время."),
      ).not.toBeVisible();
      const decision = await refreshJournal(
        "Подтвердить отправку",
        "Заявка подана",
      );
      await expect(decision).toContainText("Ваше действие");
      await expect(
        decision.getByRole("link", { name: "Мои заявки", exact: true }),
      ).toHaveAttribute("href", "/requests");
      await position(decision);
      await capture(page, "assistant-journal-decision", theme);
    });

    test("сводка дня без озвучки", async ({ page }) => {
      await installTodaySpeech(page);
      await page.clock.setFixedTime(new Date());
      await loginAs(page, "anna");
      const briefing = page.getByTestId("today-briefing");
      await expect(
        briefing.getByTestId("briefing-phrase").first(),
      ).toBeVisible();
      await expect(
        briefing.getByRole("button", { name: "Послушать", exact: true }),
      ).toBeVisible();
      await position(briefing);
      await expect
        .poll(() => page.evaluate(() => window.todaySpeech.calls))
        .toEqual([]);
      await capture(page, "today-briefing", theme);
      await expect
        .poll(() => page.evaluate(() => window.todaySpeech.calls))
        .toEqual([]);
    });

    test("палитра ⌘K: запрос, подсказки и вопрос ассистенту", async ({
      page,
    }) => {
      await loginAs(page, "anna");
      await expect(
        page.getByRole("link", { name: /Поиск по кабинету/ }),
      ).toHaveAttribute("data-palette-ready", "true");
      await page.evaluate(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "л",
            code: "KeyK",
            metaKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      const dialog = page.getByRole("dialog", {
        name: "Поиск и действия",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAccessibleDescription(
        "Найдите в своём кабинете или выберите действие.",
      );
      const input = dialog.getByRole("combobox", {
        name: "Что найти или сделать",
        exact: true,
      });
      await input.fill("геогр");
      await expect(
        dialog
          .getByRole("group", { name: "Расписание", exact: true })
          .getByRole("option")
          .first(),
      ).toContainText("Политическая география");
      await expect(dialog.getByRole("status")).toHaveText(
        /Найдено результатов: [1-9]/,
      );
      await expect(
        dialog.getByRole("option", {
          name: "Спросить ассистента: геогр",
          exact: true,
        }),
      ).toBeVisible();
      await input.press("ArrowDown");
      await capture(page, "search-palette", theme);
    });

    test("ассистент: ответ, карточка черновика и отказ на чужие данные", async ({
      page,
      loginStudent,
    }) => {
      expect(
        process.env.ASSISTANT_RUNTIME,
        "Запустите production-сервер и галерею с ASSISTANT_RUNTIME=mock.",
      ).toBe("mock");
      await loginStudent();
      const trigger = page.getByRole("button", {
        name: "Спросить или сделать",
        exact: true,
      });
      await hydrated(trigger);
      await trigger.click();
      const sheet = page.getByRole("dialog", { name: "Спросить или сделать" });
      await sheet.getByLabel("Ваш вопрос").fill("Повышенная стипендия");
      await sheet
        .getByRole("button", { name: "Задать вопрос", exact: true })
        .click();
      const log = sheet.getByRole("log");
      await expect(log).toContainText("Проверьте сведения и источники ниже");
      await expect(log.getByRole("status")).toHaveCount(0);
      await expect(
        log.locator('a[href="/regulations/scholarship#p-2"]').first(),
      ).toBeVisible();
      await expect(
        sheet.getByRole("region", { name: "Черновик заявки" }),
      ).toHaveCount(0);
      await position(log.locator("article").last());
      await capture(page, "assistant-answer", theme);
      await sheet
        .getByLabel("Ваш вопрос")
        .fill(
          "Как получить справку для работодателя? Получатель — работодателя",
        );
      await sheet
        .getByRole("button", { name: "Задать вопрос", exact: true })
        .click();
      const card = sheet.getByRole("region", { name: "Черновик заявки" });
      await expect(card).toContainText("Справка об обучении");
      await expect(
        sheet.getByRole("button", {
          name: "Подтвердить отправку",
          exact: true,
        }),
      ).toBeEnabled();
      await position(card);
      await capture(page, "assistant-draft", theme);
      await position(
        card.getByRole("button", { name: "Подтвердить отправку", exact: true }),
      );
      await capture(page, "assistant-confirmation", theme);
      await sheet.getByLabel("Ваш вопрос").fill("Покажи оценки Тимура");
      await sheet
        .getByRole("button", { name: "Задать вопрос", exact: true })
        .click();
      const refusal = sheet.getByText(/Я могу помочь только с вашими данными/);
      await expect(refusal).toBeVisible();
      await position(refusal);
      await capture(page, "assistant-refusal", theme);
      await expect(log.getByRole("status")).toHaveCount(0);
      await sheet
        .getByRole("link", { name: "Мой журнал", exact: true })
        .click();
      await expect(page).toHaveURL(/\/profile\/assistant$/);
      const entries = page
        .getByRole("region", { name: "Последние обращения", exact: true })
        .locator(":scope > ol > li");
      await expect(async () => {
        await page.reload();
        await expect(
          entries.filter({ hasText: "Повышенная стипендия" }),
        ).toContainText("Ответил", { timeout: 1000 });
        await expect(
          entries.filter({ hasText: "Как получить справку для работодателя?" }),
        ).toContainText("Подготовил черновик", { timeout: 1000 });
        await expect(
          entries.filter({ hasText: "Покажи оценки Тимура" }),
        ).toContainText("Отказал", { timeout: 1000 });
      }).toPass({ timeout: 15000 });
    });

    test("M5: развилка сдать или пропустить", async ({ page }) => {
      const student = await openStudentTestData("anna");
      try {
        await loginAsTestStudent(page, student.credentials);
        await open(page, "/grades", "Учёба");
        await page
          .getByTestId("grade-course")
          .filter({
            has: page.getByRole("heading", {
              name: "Иностранный язык",
              exact: true,
            }),
          })
          .getByRole("link", { name: /Подробнее/ })
          .click();
        await expect(page).toHaveURL(/\/grades\/[0-9a-f-]+$/);
        const region = page.getByRole("region", {
          name: "Что если?",
          exact: true,
        });
        const slider = region.getByRole("slider").first();
        await expect(slider).toHaveValue("77");
        await hydrated(slider);
        const fork = region.getByTestId("grade-outcome-fork").first();
        await expect(fork.getByTestId("fork-submit")).toHaveAttribute(
          "data-selected",
          "true",
        );
        await expect(fork.getByTestId("fork-skip")).toContainText("Пропустить");
        await position(fork);
        await capture(page, "grades-fork", theme);
      } finally {
        try {
          await page.close();
        } finally {
          await student.close();
        }
      }
    });

    test("M5: первые шаги первокурсника", async ({ page }) => {
      const student = await openStudentTestData("timur");
      try {
        await loginAsTestStudent(page, student.credentials);
        const card = page.getByRole("region", {
          name: "Первые шаги",
          exact: true,
        });
        await expect(card).toHaveAttribute("data-onboarding-ready", "true");
        await expect(
          card.locator('[data-onboarding-step="schedule"]'),
        ).toBeVisible();
        await position(card);
        await capture(page, "today-onboarding", theme);
      } finally {
        try {
          await page.close();
        } finally {
          await student.close();
        }
      }
    });

    test("M5: настройки и уведомления на телефон", async ({ page }) => {
      // Exercise the product's unsupported state without a worker or system notification.
      await page.addInitScript(() =>
        Object.defineProperty(window, "PushManager", {
          configurable: true,
          value: undefined,
        }),
      );
      await loginAs(page, "anna");
      await open(page, "/profile", "Профиль");
      const settings = page.getByRole("region", {
        name: "Настройки",
        exact: true,
      });
      await expect(settings).toHaveAttribute("data-settings-ready", "true");
      await position(settings);
      await capture(page, "profile-settings", theme);
      const push = page.locator('[data-push-state="unavailable"]');
      await expect(
        push.getByRole("heading", {
          name: "Уведомления на телефон",
          exact: true,
        }),
      ).toBeVisible();
      await position(push);
      await capture(page, "profile-push", theme);
    });

    test("M5: ключ доступа временного студента и вход", async ({
      page,
      context,
      baseURL,
    }) => {
      expect(
        new URL(baseURL ?? "").hostname,
        "Для WebAuthn нужен localhost и такой же APP_ORIGIN сервера.",
      ).toBe("localhost");
      const student = await openStudentTestData("anna");
      const cdp = await context.newCDPSession(page).catch(async (error) => {
        await student.close();
        throw error;
      });
      let authenticatorId: string | undefined;
      try {
        await page.addInitScript(() => {
          if (typeof PublicKeyCredential !== "undefined")
            Object.defineProperty(
              PublicKeyCredential,
              "isConditionalMediationAvailable",
              { configurable: true, value: async () => false },
            );
        });
        await cdp.send("WebAuthn.enable");
        ({ authenticatorId } = await cdp.send(
          "WebAuthn.addVirtualAuthenticator",
          {
            options: {
              protocol: "ctap2",
              transport: "internal",
              hasResidentKey: true,
              hasUserVerification: true,
              isUserVerified: true,
              automaticPresenceSimulation: true,
            },
          },
        ));
        await loginAsTestStudent(page, student.credentials);
        await open(page, "/profile", "Профиль");
        const card = page.getByRole("region", {
          name: "Ключи доступа",
          exact: true,
        });
        await expect(
          card.getByRole("button", { name: "Добавить ключ", exact: true }),
        ).toBeEnabled();
        await registerKey(page, "Личный телефон");
        await position(card);
        await capture(page, "profile-passkeys", theme);
        await page.getByRole("button", { name: "Выйти", exact: true }).click();
        await expect(page).toHaveURL(/\/login$/);
        const login = page.getByRole("button", {
          name: "Войти с ключом доступа",
          exact: true,
        });
        await expect(login).toBeEnabled();
        await top(page);
        await capture(page, "login-passkey", theme);
        await login.click();
        await expect(page).toHaveURL(/\/today$/);
      } finally {
        try {
          if (authenticatorId)
            await cdp.send("WebAuthn.removeVirtualAuthenticator", {
              authenticatorId,
            });
        } finally {
          try {
            await cdp.detach();
          } finally {
            try {
              await page.close();
            } finally {
              await student.close();
            }
          }
        }
      }
    });

    test("M5: ведомость, причина до сохранения и история студента", async ({
      page,
    }) => {
      const f = await openTeacherGradesTestData({
        ...attendanceNames,
        courseTitle: "Практикум международных переговоров",
        lessonTime: "around-now",
      });
      try {
        await loginAsTestTeacher(page, f.teacher.credentials);
        await open(page, f.path, f.courseTitle);
        const form = page.getByRole("form", {
          name: `${attendanceNames.studentNames[0]} — ${f.workTitle}`,
          exact: true,
        });
        await expect(form).toHaveAttribute("data-hydrated", "true");
        await position(
          page.getByRole("region", {
            name: "Ведомость студентов",
            exact: true,
          }),
        );
        await capture(page, "teacher-gradebook", theme);
        const score = form.getByRole("spinbutton", {
          name: "Балл",
          exact: true,
        });
        const save = form.getByRole("button", {
          name: "Сохранить балл",
          exact: true,
        });
        await score.fill("80");
        await save.click();
        await expect(form.getByRole("status")).toContainText("Балл сохранён");
        await expect(form.locator('input[name="expectedScore"]')).toHaveValue(
          "80",
        );
        await score.fill("90");
        await form
          .getByRole("combobox", { name: "Причина изменения", exact: true })
          .selectOption("retake");
        await expect(form.locator('input[name="expectedScore"]')).toHaveValue(
          "80",
        );
        await position(form);
        await capture(page, "teacher-grade-edit", theme);
        await save.click();
        await expect(form.locator('input[name="expectedScore"]')).toHaveValue(
          "90",
        );
        await loginAsTestStudent(page, f.student.credentials);
        await open(page, `/grades/${f.courseId}`, f.courseTitle);
        const history = page.getByRole("region", {
          name: "История изменений",
          exact: true,
        });
        await expect(history).toContainText("80 → 90");
        await expect(history).toContainText("Пересдача");
        await position(history);
        await capture(page, "grades-history", theme);
      } finally {
        try {
          await page.close();
        } finally {
          await f.close();
        }
      }
    });

    test("M5: слот, талон, вызов и очередь сотрудника", async ({ page }) => {
      const f = await openPickupFixture({
        studentNames: [
          attendanceNames.studentNames[0],
          attendanceNames.studentNames[1],
        ],
        staffName: "Таисия Сергеевна Рощина",
        windowTitle: "Окно 2 · выдача справок",
        destination: "Проектная мастерская «Север»",
      });
      try {
        const requestId = await f.ready();
        await loginAsTestStudent(page, f.studentCredentials.anna);
        const response = await page.goto(`/requests/${requestId}`);
        expect(response?.status()).toBe(200);
        const card = page.getByTestId("pickup-card");
        await expect(card).toHaveAttribute("data-ready", "true");
        await card
          .getByLabel("Окно выдачи", { exact: true })
          .selectOption(f.windowId);
        const dateSelect = card.getByLabel("Дата получения", { exact: true });
        await expect(dateSelect).toBeVisible();
        const selectedDay = await dateSelect
          .locator("option")
          .last()
          .getAttribute("value");
        if (!selectedDay) throw new Error("Нет будущего рабочего дня.");
        await dateSelect.selectOption(selectedDay);
        const timeSelect = card.getByLabel("Время получения (МСК)", {
          exact: true,
        });
        await expect(timeSelect).toBeVisible();
        const selectedTime = await timeSelect
          .locator("option")
          .last()
          .getAttribute("value");
        if (!selectedTime) throw new Error("Нет времени выдачи.");
        await timeSelect.selectOption(selectedTime);
        await position(card);
        await capture(page, "requests-pickup-slot", theme);
        await card
          .getByRole("button", { name: "Записаться на получение", exact: true })
          .click();
        const ticket = page.getByTestId("pickup-ticket");
        await expect(ticket).toBeVisible();
        const [booking] = await f.sql<
          { id: string; ticketNo: string }[]
        >`select id, ticket_no as "ticketNo" from pickup_bookings where request_id = ${requestId} and status = 'booked'`;
        if (!booking) throw new Error("Талон не создан.");
        await expect(ticket).toContainText(booking.ticketNo);
        await position(ticket);
        await capture(page, "requests-pickup-ticket", theme);
        const bookings = [booking];
        for (const owner of [f.second, f.anna]) {
          f.clock.set(new Date());
          const ready = await f.ready(owner);
          const options = await f.getPickup.execute(owner, { id: ready });
          const window = options?.windows.find(
            (item) => item.id === f.windowId,
          );
          // Ticket numbers are daily: keep all bookings on the same day before moving them.
          const slotStartsAt = window?.slots.find(
            (slot) => moscowDate(new Date(slot)) === selectedDay,
          );
          if (!slotStartsAt)
            throw new Error("Нет свободного временного слота.");
          const booked = await f.book.execute(owner, {
            id: ready,
            windowId: f.windowId,
            slotStartsAt,
          });
          bookings.push({ id: booked.id, ticketNo: booked.ticketNo });
        }
        await loginAsTestStaff(page, f.limitedCredentials);
        const now = new Date();
        const date = moscowDate(now);
        const midnight = Date.parse(atMoscow(date, "00:00:00"));
        const minute = Math.floor((now.getTime() - midnight) / 600_000) * 10;
        const firstMinute = Math.max(0, Math.min(1410, minute - 10));
        for (const [index, item] of bookings.entries())
          await f.bringToToday(
            item.id,
            new Date(
              midnight + (firstMinute + index * 10) * 60_000,
            ).toISOString(),
          );
        await open(page, "/staff/pickup", "Очередь сегодня");
        const queue = page.getByRole("region", {
          name: "Талоны на сегодня",
          exact: true,
        });
        await expect(queue).toHaveAttribute("data-ready", "true");
        await expect(queue.getByTestId("pickup-queue-ticket")).toHaveCount(3);
        const called = queue
          .getByTestId("pickup-queue-ticket")
          .filter({ hasText: booking.ticketNo });
        await called
          .getByRole("button", { name: "Вызвать", exact: true })
          .click();
        await expect(called).toContainText("Вызван");
        await expect(
          queue
            .getByTestId("pickup-queue-ticket")
            .filter({ hasText: "Ожидает" }),
        ).toHaveCount(2);
        await top(page);
        await capture(page, "staff-pickup-queue", theme);
        await loginAsTestStudent(page, f.studentCredentials.anna);
        await page.goto(`/requests/${requestId}`);
        await expect(card).toHaveAttribute("data-ready", "true");
        await expect(ticket.getByRole("status")).toContainText("Вас вызывают");
        await position(ticket);
        await capture(page, "requests-pickup-called", theme);
      } finally {
        try {
          await page.close();
        } finally {
          await f.close();
        }
      }
    });

    test("M5: английские экраны студента", async ({
      page,
      context,
      baseURL,
    }) => {
      if (!baseURL) throw new Error("Нужен адрес приложения.");
      const student = await openStudentTestData("anna");
      try {
        await context.addCookies([
          { name: "pulse-language", value: "en", url: baseURL },
        ]);
        await open(page, "/login", "Sign in to Pulse");
        await expect(page.locator("html")).toHaveAttribute("lang", "en");
        await capture(page, "login-default-en", theme);
        await page
          .getByLabel("Username", { exact: true })
          .fill(student.credentials.login);
        await page
          .getByLabel("Password", { exact: true })
          .fill(student.credentials.password);
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await expect(page).toHaveURL(/\/today$/);
        await open(page, "/today", "Today");
        await expect(
          page
            .getByTestId("today-briefing")
            .getByTestId("briefing-phrase")
            .first(),
        ).toBeVisible();
        await capture(page, "today-en", theme);
        await open(page, "/schedule?view=week", "Schedule");
        await expect(
          page.getByRole("link", { name: "Week", exact: true }),
        ).toHaveAttribute("aria-current", "page");
        await capture(page, "schedule-week-en", theme);
        await open(page, "/grades", "Study");
        await expect(page.getByTestId("grade-course").first()).toBeVisible();
        await capture(page, "grades-default-en", theme);
        await page
          .getByTestId("grade-course")
          .filter({
            has: page.getByRole("heading", {
              name: "Иностранный язык",
              exact: true,
            }),
          })
          .locator('a[href^="/grades/"]')
          .click();
        await expect(page).toHaveURL(/\/grades\/[0-9a-f-]+$/);
        await expect(
          page.getByRole("heading", {
            name: "Иностранный язык",
            exact: true,
            level: 1,
          }),
        ).toBeVisible();
        await top(page);
        await capture(page, "grades-course-en", theme);
        await open(page, "/requests/new?type=enrollment", "New request");
        const form = page.getByTestId("request-form");
        await expect(form).toHaveAttribute("data-ready", "true");
        const recipient = form.getByLabel("Recipient (required)", {
          exact: true,
        });
        await recipient.fill("Fictional employer «Northstar»");
        await position(recipient);
        await capture(page, "requests-form-en", theme);
        await form
          .getByRole("button", { name: "Check request", exact: true })
          .click();
        await expect(
          form.getByRole("heading", {
            name: "Review your request",
            exact: true,
          }),
        ).toBeVisible();
        await form
          .getByRole("button", { name: "Confirm submission", exact: true })
          .click();
        await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
        await expect(
          page.getByRole("heading", { name: "Request progress", exact: true }),
        ).toBeVisible();
        await expect(page.locator('main [aria-current="step"]')).toContainText(
          "Submitted",
        );
        await top(page);
        await capture(page, "requests-tracker-en", theme);
        await open(page, "/profile", "Profile");
        const settings = page.getByRole("region", {
          name: "Settings",
          exact: true,
        });
        await expect(settings).toHaveAttribute("data-settings-ready", "true");
        await position(settings);
        await capture(page, "profile-settings-en", theme);
      } finally {
        try {
          await page.close();
        } finally {
          await student.close();
        }
      }
    });

    test("M5: английская шторка с черновиком ассистента", async ({
      page,
      context,
      baseURL,
      loginStudent,
    }) => {
      expect(process.env.ASSISTANT_RUNTIME).toBe("mock");
      if (!baseURL) throw new Error("Нужен адрес приложения.");
      await loginStudent();
      await context.addCookies([
        { name: "pulse-language", value: "en", url: baseURL },
      ]);
      await open(page, "/profile/assistant", "My assistant journal");
      const start = page
        .getByRole("main")
        .getByRole("button", { name: "Ask the assistant", exact: true });
      await expect(start).toHaveAttribute("data-journal-ready", "true");
      await start.click();
      const sheet = page.getByRole("dialog", {
        name: "Ask or get things done",
        exact: true,
      });
      await expect(sheet.locator("[data-assistant-ready]")).toHaveAttribute(
        "data-assistant-ready",
        "true",
      );
      // The mock understands Russian questions; the card's interface still follows the language cookie.
      const question =
        "Нужна справка для работодателя. Получатель — Fictional employer Northstar";
      await sheet.getByLabel("Your question", { exact: true }).fill(question);
      await sheet
        .getByRole("button", { name: "Ask question", exact: true })
        .click();
      const card = sheet.getByRole("region", {
        name: /^Request draft \d+: Enrolment certificate$/,
      });
      await expect(
        card.getByRole("button", { name: "Confirm submission", exact: true }),
      ).toBeEnabled();
      await expect(
        sheet.getByText("Thinking… The answer may take a little time.", {
          exact: true,
        }),
      ).not.toBeVisible();
      await position(card);
      await capture(page, "assistant-draft-en", theme);
      await sheet
        .getByRole("link", { name: "My journal", exact: true })
        .click();
      await expect(page).toHaveURL(/\/profile\/assistant$/);
      await expect(async () => {
        await page.reload();
        await expect(
          page
            .getByRole("main")
            .getByRole("listitem")
            .filter({ hasText: question }),
        ).toContainText("Prepared a draft", { timeout: 1000 });
      }).toPass({ timeout: 15000 });
    });

    for (const mode of ["large-text", "high-contrast"] as const) {
      test(`M5: режим доступности ${mode}`, async ({
        page,
        context,
        baseURL,
      }) => {
        if (!baseURL) throw new Error("Нужен адрес приложения.");
        await context.addCookies([
          { name: `pulse-${mode}`, value: "on", url: baseURL },
        ]);
        await loginAs(page, "anna");
        for (const [path, title, name] of [
          ["/today", "Сегодня", "today"],
          ["/grades", "Учёба", "grades"],
        ] as const) {
          await open(page, path, title);
          await expect(page.locator("html")).toHaveClass(
            new RegExp(`a11y-${mode}`),
          );
          await capture(page, `${name}-${mode}`, theme);
        }
      });
    }

    test("справка: публичная проверка и первая страница PDF", async ({
      page,
      certificates: f,
      certificateIp,
      context,
    }, info) => {
      test.skip(
        theme === "dark",
        "Публичная проверка и PDF не зависят от темы кабинета: один светлый вариант.",
      );
      const ready = await f.request();
      if (!ready.certificate) throw new Error("Нужна готовая справка.");
      await loginAsTestStudent(page, f.anna.credentials);
      await page.goto(`/requests/${ready.id}`);
      const downloaded = page.waitForEvent("download");
      await page
        .getByRole("link", { name: "Скачать PDF", exact: true })
        .click();
      const pdfPath = info.outputPath("certificate.pdf");
      await (await downloaded).saveAs(pdfPath);
      const pdf = await readFile(pdfPath);
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
      const prefix = info.outputPath("certificate-first-page");
      await attachCertificatePdfScreenshot(pdfPath, prefix, info);
      const png = await readFile(`${prefix}.png`);
      await context.clearCookies();
      await context.setExtraHTTPHeaders({ "x-forwarded-for": certificateIp });
      // The page h1 is «Проверка справки»; the status is the card's h2.
      await open(
        page,
        `/verify/${ready.certificate.verifyCode}`,
        "Проверка справки",
      );
      await expect(
        page.getByRole("heading", {
          level: 2,
          name: "Справка действительна",
          exact: true,
        }),
      ).toBeVisible();
      await capture(page, "certificates-verify", theme, false, false);
      const background = await page
        .locator("body")
        .evaluate((element) => getComputedStyle(element).backgroundColor);
      const pdfPage = await context.newPage();
      try {
        // A PDF keeps its paper colour in both themes; the image is fitted to the fixed viewport.
        await pdfPage.setContent(`<!doctype html><html lang="ru" class="${theme}"><head><title>Первая страница справки</title><style>
        *{box-sizing:border-box}body{margin:0;background:${background}}
        main{height:100vh;display:flex;justify-content:center;align-items:flex-start}
        img{max-width:100%;max-height:100%;object-fit:contain}
        h1{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
        </style></head><body><main><h1>Первая страница вымышленной справки</h1><img alt="Первая страница справки об обучении с QR-кодом проверки. Вымышленный документ конкурсного концепта." src="data:image/png;base64,${png.toString("base64")}"></main></body></html>`);
        await expect
          .poll(() =>
            pdfPage
              .locator("img")
              .evaluate((img) => (img as HTMLImageElement).naturalWidth),
          )
          .toBeGreaterThan(0);
        await capture(pdfPage, "certificates-pdf-first-page", theme);
      } finally {
        await pdfPage.close();
      }
    });

    test("настоящие error.tsx с кнопкой повтора и loading.tsx при задержке ответа", async ({
      page,
    }) => {
      await loginAs(page, "anna");
      await open(page, "/profile", "Профиль");
      await page.route("**/today?*", async (route) => {
        if (route.request().headers().rsc !== "1") return route.continue();
        const response = await route.fetch();
        const body = await response.text();
        // An automatic prefetch may contain only layout/loading, with no page result yet.
        if (!body.includes('"h1",null,{"children":"Сегодня"'))
          return route.fulfill({ response, body });
        const { record, id } = pageRecord(body, "Сегодня");
        await route.fulfill({
          response,
          body: body.replace(record, `${id}:E{"digest":"GALLERY_PAGE_ERROR"}`),
        });
      });
      const today = page
        .getByRole("navigation", { name: "Основная навигация", exact: true })
        .filter({ visible: true })
        .getByRole("link", { name: "Сегодня", exact: true });
      await today.click();
      await expect(page).toHaveURL(/\/today$/);
      await expect(
        page.getByRole("heading", {
          name: "Не получилось открыть страницу",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Повторить", exact: true }),
      ).toBeVisible();
      await capture(page, "today-error", theme);
      await page.unroute("**/today?*");

      await open(page, "/profile", "Профиль");
      // Wait for Next's automatic partial prefetch: it carries the real loading.tsx fallback.
      await expect
        .poll(() =>
          page.evaluate(() =>
            performance
              .getEntriesByType("resource")
              .some(
                (entry) =>
                  new URL(entry.name).pathname === "/today" &&
                  (entry as PerformanceResourceTiming).responseEnd > 0,
              ),
          ),
        )
        .toBe(true);
      let release = () => {};
      const delayed = new Promise<void>((done) => {
        release = done;
      });
      await page.route("**/today?*", async (route) => {
        if (route.request().headers().rsc !== "1") return route.continue();
        await delayed;
        await route.continue();
      });
      try {
        await today.click();
        const skeleton = page.getByRole("region", {
          name: "Загрузка страницы",
          exact: true,
        });
        await expect(skeleton).toHaveAttribute("aria-busy", "true");
        await expect(skeleton).toBeVisible();
        await capture(page, "today-loading", theme, true);
      } finally {
        release();
      }
      await expect(
        page.getByRole("heading", { name: "Сегодня", exact: true, level: 1 }),
      ).toBeVisible();
      await page.unroute("**/today?*");
    });

    test.describe("PWA", () => {
      test.use({ serviceWorkers: "allow" });

      test("офлайн-копия через активный service worker", async ({
        page,
        context,
      }) => {
        await loginAs(page, "anna");
        await expect
          .poll(() =>
            page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
          )
          .toBe(true);
        await open(page, "/schedule", "Расписание");
        await expect
          .poll(() =>
            page.evaluate(() =>
              performance.getEntriesByType("resource").some((entry) => {
                const resource = entry as PerformanceResourceTiming;
                return (
                  new URL(resource.name).pathname === "/schedule" &&
                  resource.initiatorType === "fetch" &&
                  resource.workerStart > 0 &&
                  resource.responseEnd > 0
                );
              }),
            ),
          )
          .toBe(true);
        await expect
          .poll(() =>
            page.evaluate(async (prefix) => {
              const names = (await caches.keys()).filter((name) =>
                name.startsWith(prefix),
              );
              return (
                await Promise.all(
                  names.map(async (name) =>
                    (
                      await (await caches.open(name)).keys()
                    ).map((request) => new URL(request.url).pathname),
                  ),
                )
              ).flat();
            }, PAGE_CACHE_PREFIX),
          )
          .toContain("/schedule");
        try {
          await context.setOffline(true);
          await page.reload();
          await expect(page.locator("[data-pwa-offline]")).toContainText(
            "Нет сети — показана версия от",
          );
          await capture(page, "schedule-offline", theme);
        } finally {
          await context.setOffline(false);
        }
      });

      test("подсказка установки", async ({ page }) => {
        await loginAs(page, "anna");
        await hydrated(
          page.getByRole("button", {
            name: "Спросить или сделать",
            exact: true,
          }),
        );
        // Chromium owns this event; headless tests offer it through the same app listener.
        await page.evaluate(() => {
          const event = new Event("beforeinstallprompt", { cancelable: true });
          Object.assign(event, {
            prompt: async () => {},
            userChoice: Promise.resolve({ outcome: "dismissed" }),
          });
          window.dispatchEvent(event);
        });
        await expect(
          page.getByRole("region", { name: "Установка Пульса" }),
        ).toBeVisible();
        await top(page);
        await capture(page, "today-install", theme);
      });
    });
  });
}
