import { randomUUID } from "node:crypto";
import { GetCourseActions } from "@/application/grades/get-course-actions";
import type { GetCourseGrades } from "@/application/grades/get-my-grades";
import type { ScoreHistoryDto } from "@/application/grades/history";
import { reasonCodes } from "@/application/grades/score-reasons";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresGradesRepository } from "@/infrastructure/db/repositories/grades/grades";
import { PostgresSessionStore } from "@/infrastructure/db/repositories/identity/sessions";
import { openStudentTestData, type StudentTestData } from "./student-e2e-data";

type Language = "ru" | "en";
type CourseData = Awaited<ReturnType<GetCourseGrades["execute"]>>;

function visibleText(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, "")
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'");
}

export async function checkGradesI18nHttp(baseURL: string) {
  const origin = new URL(baseURL).origin;
  const sql = createDatabase(1);
  const repository = new PostgresGradesRepository(() => sql);
  const sessions = new PostgresSessionStore(() => sql);
  const tokens = new CryptoSessionTokens();
  const students: StudentTestData[] = [];
  const sessionIds: string[] = [];
  const cookies = new Map<string, string>();
  let checks = 0;
  function check(value: unknown, message: string): asserts value {
    if (!value) throw new Error(`HTTP TASK-50: ${message}`);
    checks++;
  }
  async function request(
    path: string,
    student: StudentTestData,
    language: Language,
    json = false,
  ) {
    const response = await fetch(new URL(path, origin), {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Accept: json ? "application/json" : "text/html",
        "Accept-Language":
          language === "en" ? "en-GB,en;q=0.9" : "ru-RU,ru;q=0.9",
        Origin: origin,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": json ? "cors" : "navigate",
        "Sec-Fetch-Dest": json ? "empty" : "document",
        Cookie: `${cookies.get(student.actor.userId) ?? ""}; pulse-language=${language}`,
      },
    });
    const body = await response.text();
    check(
      response.headers.get("cache-control")?.includes("no-store"),
      "личные страницы и JSON не кэшируются",
    );
    return { response, body, text: visibleText(body) };
  }

  try {
    for (const scenario of ["anna", "timur"] as const) {
      const student = await openStudentTestData(scenario);
      students.push(student);
      const token = tokens.generate();
      const id = randomUUID();
      const now = new Date().toISOString();
      await sessions.create({
        id,
        userId: student.actor.userId,
        tokenHash: tokens.hash(token),
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      sessionIds.push(id);
      cookies.set(student.actor.userId, `__Host-pulse-session=${token}`);
    }
    const [anna, timur] = students;
    check(anna && timur, "временные студенты созданы");

    for (const [index, student] of students.entries()) {
      const record = await repository.listForStudent(student.actor.studentId);
      const course = record?.courses.find(
        (item) =>
          item.title ===
          (index === 0 ? "Иностранный язык" : "Основы маркетинга"),
      );
      check(record && course, "сид содержит нужную дисциплину");
      const path = `/grades/${course.id}`;
      let originalData: string | undefined;
      for (const language of ["ru", "en"] as const) {
        const english = language === "en";
        const list = await request("/grades", student, language);
        check(list.response.status === 200, "список дисциплин → 200");
        check(
          list.body.includes(`<html lang="${language}"`),
          "язык страницы определяется cookie",
        );
        check(
          list.text.includes(english ? "How am I doing" : "Как у меня дела") &&
            list.text.includes(english ? "Scholarship" : "Стипендия") &&
            list.text.includes(course.title),
          "сводка и стипендия переведены, название из БД сохранено",
        );
        if (index === 0) {
          check(
            list.text.includes(
              english ? "at least 77 out of 100" : "не меньше 77 из 100",
            ),
            "Анна: минимум повышенной стипендии остаётся 77",
          );
        } else {
          check(
            list.text.includes(english ? "Outstanding work" : "Есть долг"),
            "Тимур: долг показан на выбранном языке",
          );
        }

        const detail = await request(`${path}?actions=1`, student, language);
        check(detail.response.status === 200, "карточка дисциплины → 200");
        for (const label of english
          ? [
              "What if?",
              "Works and deadlines",
              "Score history",
              "How is it calculated?",
            ]
          : [
              "Что если?",
              "Работы и сроки",
              "История изменений",
              "Как считается?",
            ]) {
          check(
            detail.text.includes(label),
            "карточка содержит переведённый раздел",
          );
        }
        for (const work of course.works) {
          check(
            detail.text.includes(work.title),
            "название работы из БД сохранено",
          );
        }
        if (index === 0) {
          check(
            detail.text.includes(
              english ? "Current: 78.3 out of 100" : "Сейчас: 78,3 из 100",
            ) &&
              detail.text.includes(
                english ? "Total 86 out of 100" : "Итог 86 из 100",
              ) &&
              detail.text.includes(
                english ? "Total 78.3 out of 100" : "Итог 78,3 из 100",
              ),
            "Анна: развилка 86/78,3 и десятичный разделитель по языку",
          );
          check(
            /type="range"[^>]*value="77"/.test(detail.body),
            "начальное значение расчёта Анны равно 77",
          );
        } else {
          check(
            detail.text.includes(
              english ? "What can I do?" : "Что можно сделать?",
            ) &&
              detail.text.includes(
                english ? "Prepare an enquiry" : "Подготовить обращение",
              ),
            "Тимур: варианты действий и подготовка обращения переведены",
          );
          if (english) {
            check(
              detail.text.includes(
                "The enquiry sent to the dean’s office is in Russian.",
              ),
              "English: пометка о русском обращении видима",
            );
          }
          const plan = await new GetCourseActions(repository, {
            now: () => new Date(),
          }).execute(student.actor, { courseId: course.id });
          check(plan, "план действий доступен студенту");
          check(
            plan.appeal.question.startsWith(
              "Вопрос по дисциплине «Основы маркетинга»",
            ) && plan.appeal.question.includes("Подскажите, как"),
            "текст обращения сотруднику остаётся русским",
          );
          check(
            plan.options.every((option) =>
              ["overdue", "submit", "review"].includes(option.code),
            ),
            "DTO вариантов действий содержит закрытые коды",
          );
        }
        const api = await request(`${path}/data`, student, language, true);
        check(api.response.status === 200, "JSON своей дисциплины → 200");
        const data = JSON.parse(api.body) as CourseData;
        check(
          data.course.title === course.title &&
            data.course.light.code &&
            !Object.hasOwn(data.course.light, "label") &&
            (!data.course.grade ||
              (data.course.grade.code &&
                !Object.hasOwn(data.course.grade, "label"))),
          "JSON содержит коды оценок и индикатора вместо русских подписей",
        );
        if (originalData === undefined) originalData = api.body;
        else
          check(
            api.body === originalData,
            "язык не меняет числа и DTO дисциплины",
          );
      }

      const other = index === 0 ? timur : anna;
      for (const language of ["ru", "en"] as const) {
        for (const suffix of ["", "/data", "/history"]) {
          const denied = await request(
            `${path}${suffix}`,
            other,
            language,
            suffix !== "",
          );
          const missing = await request(
            `/grades/00000000-0000-7000-8000-000000ffffee${suffix}`,
            other,
            language,
            suffix !== "",
          );
          check(
            denied.response.status === 404 && missing.response.status === 404,
            "IDOR: чужая и отсутствующая дисциплина → 404 на странице/data/history",
          );
          check(
            !denied.body.includes(course.title) &&
              !denied.body.includes('data-testid="grade-outcome-fork"'),
            "IDOR: чужие название и развилка не раскрыты",
          );
        }
      }
    }

    const record = await repository.listForStudent(anna.actor.studentId);
    const course = record?.courses.find(
      (item) => item.title === "Иностранный язык",
    );
    const work = course?.works[0];
    const [teacher] = await sql<
      { id: string }[]
    >`select id from users where login = 'oleg'`;
    check(course && work && teacher, "данные для истории доступны");
    const reasons = [...reasonCodes, "Неизвестная тестовая причина"];
    for (const [index, reason] of reasons.entries()) {
      const at = new Date(Date.UTC(2026, 10, 5, 12, index)).toISOString();
      await sql`insert into score_events (id, assessment_id, student_id, student_user_id, previous_score, new_score, changed_by_user_id, reason, created_at)
        values (${randomUUID()}, ${work.id}, ${anna.actor.studentId}, ${anna.actor.userId}, 20, 21, ${teacher.id}, ${reason}, ${at}::timestamptz)`;
    }
    const labels = {
      en: [
        "Review after an appeal",
        "Correction of an entry error",
        "Retake",
        "Valid reason",
        "Late submission",
        "Reason being clarified",
      ],
      ru: [
        "Пересмотр после апелляции",
        "Исправление ошибки ввода",
        "Пересдача",
        "Уважительная причина",
        "Работа сдана позже",
        "Причина уточняется",
      ],
    };
    for (const language of ["ru", "en"] as const) {
      const path = `/grades/${course.id}`;
      const history = await request(`${path}/history`, anna, language, true);
      check(history.response.status === 200, "JSON истории своего курса → 200");
      const data = JSON.parse(history.body) as ScoreHistoryDto;
      check(
        data.entries.length === reasons.length &&
          reasonCodes.every((reason) =>
            data.entries.some((entry) => entry.reason === reason),
          ) &&
          data.entries.some((entry) => entry.reason === "clarification") &&
          !history.body.includes("Неизвестная тестовая причина"),
        "история возвращает закрытые коды; неизвестная причина скрыта",
      );
      const detail = await request(path, anna, language);
      check(detail.response.status === 200, "страница истории → 200");
      for (const label of labels[language]) {
        check(
          detail.text.includes(label),
          "причина истории переведена по коду",
        );
      }
      const expectedDate = new Intl.DateTimeFormat(
        language === "en" ? "en-GB" : "ru-RU",
        {
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Moscow",
        },
      ).format(new Date("2026-11-05T12:00:00Z"));
      check(
        detail.text.includes(expectedDate) &&
          detail.text.includes(language === "en" ? "MSK" : "МСК") &&
          !detail.text.includes("Неизвестная тестовая причина"),
        "дата истории форматируется по языку и Москве, исходная неизвестная причина скрыта",
      );
    }
    return { checks };
  } finally {
    try {
      for (const id of sessionIds) await sessions.revoke(id);
      for (const student of students) {
        await sql`delete from score_events where student_id = ${student.actor.studentId}`;
      }
      for (const student of students.reverse()) await student.close();
    } finally {
      await sql.end({ timeout: 1 });
    }
  }
}

if (import.meta.main) {
  try {
    const result = await checkGradesI18nHttp(
      `http://localhost:${process.env.PORT || "3000"}`,
    );
    console.info(
      `HTTP TASK-50 i18n: ${result.checks}/${result.checks}; временные данные очищены.`,
    );
  } catch (error) {
    console.error(
      error instanceof Error && error.message.startsWith("HTTP TASK-50:")
        ? error.message
        : "HTTP TASK-50 i18n: FAIL. Подробности соединения и данные скрыты.",
    );
    process.exitCode = 1;
  }
}
