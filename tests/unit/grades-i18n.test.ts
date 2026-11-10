import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { GetCourseActions } from "@/application/grades/get-course-actions";
import { GetMyGrades } from "@/application/grades/get-my-grades";
import { GetScoreHistory } from "@/application/grades/history";
import { reasonCodes } from "@/application/grades/score-reasons";
import { CourseDetails } from "@/ui/grades/course-card";
import { formatGradeDate, formatScore } from "@/ui/grades/format";
import { GradesView } from "@/ui/grades/grades-view";
import { ScoreHistory } from "@/ui/grades/score-history";
import { gradesMessages } from "@/ui/i18n/dictionaries/grades";
import { LanguageProvider } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { gradesFixture } from "../fakes/grades";

function english(children: React.ReactNode) {
  return renderToStaticMarkup(
    createElement(LanguageProvider, { language: "en", children }),
  );
}

it("студенческие DTO содержат коды; старый API Today сохраняет русское представление", async () => {
  const f = gradesFixture();
  const get = new GetMyGrades(f.repository, f.clock);
  const [data, legacy] = await Promise.all([
    get.executeMessages(f.timur),
    get.execute(f.timur),
  ]);
  expect(data.summary).toEqual(legacy.summary);
  expect(data.courses.map((course) => course.secured)).toEqual(
    legacy.courses.map((course) => course.secured),
  );
  for (const course of data.courses) {
    expect(course.light).not.toHaveProperty("label");
    expect(course.light).not.toHaveProperty("action");
    expect(course.light).not.toHaveProperty("reason");
    if (course.grade) expect(course.grade).not.toHaveProperty("label");
    expect(course.light.code).toEqual(expect.any(String));
  }
  expect(legacy.courses[0]?.light.label).toBe("Есть долг");
  expect(legacy.scholarship.outlook.headline).toContain("Пока без стипендии");
  const plan = await new GetCourseActions(f.repository, f.clock).execute(
    f.timur,
    { courseId: data.courses[0]?.id },
  );
  expect(plan?.appeal.question).toContain(
    "Текущий итог без новых баллов: 28,8 из 100",
  );
  expect(plan?.appeal).not.toHaveProperty("description");
  expect(plan?.options[0]).toMatchObject({ code: "overdue", baseline: 28.8 });
  for (const option of plan?.options ?? []) {
    for (const field of ["title", "description", "effect"])
      expect(option).not.toHaveProperty(field);
  }
});

it("английские список и карточка сохраняют данные дисциплин, объясняют долг и русское обращение", async () => {
  const f = gradesFixture();
  const data = await new GetMyGrades(f.repository, f.clock).executeMessages(
    f.timur,
  );
  const course = data.courses[0];
  if (!course) throw new Error("Нет вымышленной дисциплины.");
  const plan = await new GetCourseActions(f.repository, f.clock).execute(
    f.timur,
    { courseId: course.id },
  );
  const list = english(createElement(GradesView, { data }));
  expect(list).toContain("Study");
  expect(list).toContain("How am I doing");
  expect(list).toContain("Outstanding work");
  expect(list).toContain(course.title);
  expect(list).not.toContain("Есть долг");
  const detail = english(
    createElement(CourseDetails, {
      course,
      target: data.targetScore,
      plan,
      expandedActions: true,
      semester: data,
    }),
  );
  for (const text of [
    "Works and deadlines",
    "What can I do?",
    "Prepare an enquiry",
    "The enquiry sent to the dean’s office is in Russian.",
    "28.8",
    "Exams and credits",
  ])
    expect(detail).toContain(text);
  expect(detail).not.toContain("Что можно сделать?");
  expect(detail).not.toContain('aria-label="Why?');
});

it("история отдаёт только закрытые причины и переводит каждый код, включая неизвестный", async () => {
  const f = gradesFixture();
  const courseId = f.ctx.row("course:fmo:0").id;
  const rawReasons = [...reasonCodes, null, "Старый произвольный текст"];
  const history = new GetScoreHistory(f.repository, {
    listForStudentCourse: async () =>
      rawReasons.map((reason, index) => ({
        id: String(index),
        assessmentTitle: "Работа из БД",
        previousScore: null,
        newScore: 86.5,
        reason,
        createdAt: "2026-10-30T21:17:00.000Z",
      })),
  });
  const dto = await history.execute(f.anna, { courseId });
  expect(dto.entries.map((entry) => entry.reason)).toEqual([
    ...reasonCodes,
    null,
    "clarification",
  ]);
  expect(JSON.stringify(dto)).not.toContain("Старый произвольный текст");
  const html = english(createElement(ScoreHistory, { entries: dto.entries }));
  for (const code of [...reasonCodes, "clarification"] as const)
    expect(html).toContain(t("en", gradesMessages, `reason_${code}`));
  expect(html).toContain("Not graded");
  expect(html).toContain("86.5");
  expect(html).toContain(
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Moscow",
    }).format(new Date("2026-10-30T21:17:00.000Z")),
  );
  expect(html).toContain("Работа из БД");
});

it("десятичный разделитель зависит от языка, даты всегда по Москве", () => {
  expect(formatScore(78.3, "ru")).toBe("78,3");
  expect(formatScore(78.3, "en")).toBe("78.3");
  expect(formatScore(null, "en")).toBe("Not yet");
  const date = "2026-10-30T21:17:00.000Z";
  for (const language of ["ru", "en"] as const) {
    const expected = new Intl.DateTimeFormat(
      language === "ru" ? "ru-RU" : "en-GB",
      {
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Moscow",
      },
    ).format(new Date(date));
    expect(formatGradeDate(date, language)).toBe(expected);
  }
});
