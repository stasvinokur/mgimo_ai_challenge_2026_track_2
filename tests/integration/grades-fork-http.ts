import { GetCourseActions } from "@/application/grades/get-course-actions";
import { initialPredictions, whatIf } from "@/domain/grades/what-if";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresGradesRepository } from "@/infrastructure/db/repositories/grades/grades";
import { PostgresSessionStore } from "@/infrastructure/db/repositories/identity/sessions";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { formatScore } from "@/ui/grades/format";
import { isolateGradesForTest } from "./grades-actions-data";
import { openStudentTestData, type StudentTestData } from "./student-e2e-data";

const base = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
const sql = createDatabase(1);
const students: StudentTestData[] = [];
const cookies = new Map<string, string>();
const repository = new PostgresGradesRepository(() => sql);
let isolated: Awaited<ReturnType<typeof isolateGradesForTest>> | undefined;
let checks = 0;
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`HTTP TASK-40: ${message}`);
  checks++;
}
async function get(path: string, student: StudentTestData, rsc = false) {
  const response = await fetch(new URL(path, base), {
    headers: {
      Cookie: cookies.get(student.actor.userId) ?? "",
      Origin: base,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": rsc ? "cors" : "navigate",
      ...(rsc ? { RSC: "1" } : {}),
    },
  });
  return { response, body: await response.text() };
}
const text = (html: string) =>
  html.replace(/<[^>]*>/g, "").replaceAll("&gt;", ">");

try {
  const sessions = new PostgresSessionStore(() => sql);
  const tokens = new CryptoSessionTokens();
  const ids = new UuidV7Generator();
  for (const scenario of ["anna", "timur"] as const) {
    const student = await openStudentTestData(scenario);
    students.push(student);
    if (scenario === "timur") isolated = await isolateGradesForTest(student);
    const token = tokens.generate();
    const now = new Date();
    await sessions.create({
      id: ids.next(),
      userId: student.actor.userId,
      tokenHash: tokens.hash(token),
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
    });
    cookies.set(student.actor.userId, `__Host-pulse-session=${token}`);
  }
  for (const [index, student] of students.entries()) {
    const record = await repository.listForStudent(student.actor.studentId);
    const course = record?.courses.find(
      (item) =>
        item.title === (index === 0 ? "Иностранный язык" : "Основы маркетинга"),
    );
    if (!record || !course)
      throw new Error("Нужны вымышленные учебные данные.");
    const path = `/grades/${course.id}`;
    const data = await get(`${path}/data`, student);
    check(data.response.status === 200, "API своей дисциплины → 200");
    const before = data.body;
    const detail = await get(`${path}?actions=1`, student);
    check(detail.response.status === 200, "страница дисциплины → 200");
    const forks = detail.body
      .split('data-testid="grade-outcome-fork"')
      .slice(1);
    const predictions = initialPredictions(course.works, record.targetScore);
    const forecast = whatIf(course.works, predictions, record.targetScore);
    const plan = await new GetCourseActions(repository, {
      now: () => new Date(),
    }).execute(student.actor, { courseId: course.id });
    const compact = forks.filter((fork) =>
      fork.startsWith(' data-compact="true"'),
    );
    const simulation = forks.filter((fork) =>
      fork.startsWith(' data-compact="false"'),
    );
    check(
      simulation.length === forecast.remaining.length,
      "развилка у каждой несданной работы",
    );
    check(
      compact.length === plan?.options.filter((option) => option.workId).length,
      "компактные развилки вариантов действий",
    );
    for (const [position, branch] of forecast.remaining.entries()) {
      const fork = simulation[position];
      check(fork, "ветка присутствует в HTML");
      const totals = [
        ...fork.matchAll(/<p data-testid="fork-total"[^>]*>([\s\S]*?)<\/p>/g),
      ].map((match) => text(match[1] ?? ""));
      check(
        totals[0] === `Итог ${formatScore(branch.submittedTotal)} из 100`,
        "итог сдачи из домена",
      );
      check(
        totals[1] === `Итог ${formatScore(branch.skippedTotal)} из 100`,
        "итог пропуска из домена",
      );
      check(
        /data-testid="fork-submit" data-selected="true"/.test(fork),
        "начальный выбор сдачи",
      );
      check(
        fork.includes('aria-hidden="true" focusable="false"'),
        "SVG скрыт от читалок",
      );
      check(
        text(fork).includes(forecast.grade.label),
        "оценка сдачи видима текстом",
      );
      check(
        text(fork).includes(`Цель ≥ ${record.targetScore}:`),
        "цель видима текстом",
      );
    }
    for (const [position, option] of (plan?.options ?? []).entries()) {
      if (!option.outcomes) continue;
      const fork = compact[position];
      check(fork, "компактная ветка присутствует");
      check(
        text(detail.body).includes(
          `Что это даст: ${formatScore(option.score)} из ${formatScore(option.maxScore)} → итог ${formatScore(option.total)} из 100`,
        ),
        "исходный текст эффекта сохранён",
      );
      check(
        text(fork).includes(`Итог ${formatScore(option.total)} из 100`),
        "итог компактной ветки совпадает с эффектом",
      );
    }
    check(
      (await get(`${path}/data`, student)).body === before,
      "просмотр не меняет оценки",
    );
    const other = students[index === 0 ? 1 : 0];
    if (!other) throw new Error("Нужен второй студент.");
    for (const suffix of ["", "/data"]) {
      const denied = await get(`${path}${suffix}`, other);
      const missing = await get(
        `/grades/00000000-0000-7000-8000-000000ffffee${suffix}`,
        other,
      );
      check(
        denied.response.status === 404 && missing.response.status === 404,
        "чужой и отсутствующий объект → 404",
      );
      check(
        !denied.body.includes(course.title) &&
          !denied.body.includes('data-testid="grade-outcome-fork"'),
        "404 не раскрывает чужую дисциплину и исходы",
      );
    }
    const deniedRsc = await get(path, other, true);
    check(
      deniedRsc.body.includes("NEXT_HTTP_ERROR_FALLBACK;404") &&
        !deniedRsc.body.includes(course.title),
      "чужой объект скрыт в RSC",
    );
  }
  console.info(
    `HTTP TASK-40: ${checks}/${checks}; временные данные очищаются.`,
  );
} finally {
  try {
    await isolated?.close();
  } finally {
    await sql.end({ timeout: 1 });
    for (const student of students.reverse()) await student.close();
  }
}
