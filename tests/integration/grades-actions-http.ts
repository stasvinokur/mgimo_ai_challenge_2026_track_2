import { readFile } from "node:fs/promises";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresGradesRepository } from "@/infrastructure/db/repositories/grades/grades";
import { PostgresSessionStore } from "@/infrastructure/db/repositories/identity/sessions";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import {
  gradesActionDeadline,
  isolateGradesForTest,
} from "./grades-actions-data";
import { openStudentTestData } from "./student-e2e-data";

const base = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
const sql = createDatabase(1);
const students = [];
let isolated: Awaited<ReturnType<typeof isolateGradesForTest>> | undefined;
let checks = 0;
function check(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`HTTP: ${label}`);
  checks++;
}
const decode = (text: string) =>
  text
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&");
try {
  const anna = await openStudentTestData("anna");
  students.push(anna);
  const timur = await openStudentTestData("timur");
  students.push(timur);
  isolated = await isolateGradesForTest(timur);
  if (anna.actor.kind !== "student" || timur.actor.kind !== "student")
    throw new Error("Нужны студенты.");
  const sessions = new PostgresSessionStore(() => sql);
  const tokens = new CryptoSessionTokens();
  const ids = new UuidV7Generator();
  const cookies = new Map<string, string>();
  for (const student of students) {
    const token = tokens.generate();
    const now = new Date();
    await sessions.create({
      id: ids.next(),
      userId: student.actor.userId,
      tokenHash: tokens.hash(token),
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
    });
    cookies.set(student.actor.userId, `__Host-pulse-session=${token}`);
  }
  async function get(path: string, userId: string, rsc = false) {
    const response = await fetch(new URL(path, base), {
      headers: {
        Cookie: cookies.get(userId) ?? "",
        Origin: base,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": rsc ? "cors" : "navigate",
        ...(rsc ? { RSC: "1" } : {}),
      },
    });
    return { response, text: await response.text() };
  }
  const repository = new PostgresGradesRepository(() => sql);
  const data = await repository.listForStudent(timur.actor.studentId);
  const course = data?.courses.find(
    (item) => item.title === "Основы маркетинга",
  );
  const work = course?.works.find((item) => item.score === null);
  if (!course || !work) throw new Error("Нужен сценарий долга.");
  const own = (
    await repository.listForStudent(anna.actor.studentId)
  )?.courses.find((item) => item.title === "Иностранный язык");
  if (!own) throw new Error("Нужна дисциплина Анны.");
  const deadline = gradesActionDeadline(work.dueAt);
  const totalText = "28,8 из 100";
  const totalJson = '"total":28.8,';
  const totalHtml = JSON.stringify(totalJson).slice(1, -1);
  const deadlineTime = `${deadline.time} МСК`;
  const markers = [
    course.title,
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
  const noForeignFacts = (body: string) =>
    markers.every((marker) => !body.includes(marker));
  const coursePath = `/grades/${course.id}`;
  const before =
    await sql`select id from requests where student_id = ${timur.actor.studentId}`;
  const today = await get("/today", timur.actor.userId);
  check(today.response.status === 200, "Сегодня отвечает 200");
  check(
    today.text.includes(`${coursePath}?actions=1#course-actions`) &&
      today.text.includes("Что можно сделать?"),
    "Сегодня содержит вход к вариантам",
  );
  const detail = await get(
    `${coursePath}?actions=1&workId=${work.id}`,
    timur.actor.userId,
  );
  check(detail.response.status === 200, "дисциплина отвечает 200");
  check(
    detail.text.includes(totalHtml),
    "собственная дисциплина содержит JSON-маркер итога в HTML",
  );
  const courseFlight = await get(
    `${coursePath}?actions=1&workId=${work.id}`,
    timur.actor.userId,
    true,
  );
  check(
    courseFlight.response.status === 200 &&
      courseFlight.response.headers
        .get("content-type")
        ?.includes("text/x-component") &&
      courseFlight.text.includes(totalJson),
    "собственная дисциплина содержит JSON-маркер итога в RSC",
  );
  check(
    /<details[^>]*id="course-actions"[^>]*open/.test(detail.text),
    "варианты раскрыты",
  );
  check(
    detail.text.includes("Что это даст:") &&
      detail.text.includes("без этой работы — 28,8"),
    "варианты содержат эффект",
  );
  check(
    detail.text.includes("согласуйте новую дату") &&
      detail.text.includes("МСК"),
    "просроченный срок не подменён новым",
  );
  check(
    detail.text.includes("Обсудить с ассистентом"),
    "есть действие ассистента",
  );
  const formPath = `/requests/new?type=question&courseId=${course.id}&workId=${work.id}`;
  const form = await get(formPath, timur.actor.userId);
  check(form.response.status === 200, "форма отвечает 200");
  const question = decode(
    form.text.match(
      /<textarea[^>]*name="question"[^>]*>([\s\S]*?)<\/textarea>/,
    )?.[1] ?? "",
  );
  check(
    question.startsWith("Вопрос по дисциплине «Основы маркетинга»\n"),
    "тема — первая строка",
  );
  check(
    question.includes(work.title) &&
      question.includes(`Срок: ${deadline.label} МСК`) &&
      question.includes(`Текущий итог без новых баллов: ${totalText}`) &&
      question.includes(deadlineTime),
    "текст содержит факты",
  );
  check(question.length <= 2000, "предзаполнение помещается в поле");
  check(
    question.split(course.title).length === 2,
    "дисциплина не повторяется в обращении",
  );
  check(
    /<textarea[^>]*name="question"[^>]*class="[^"]*\[field-sizing:content\]/.test(
      form.text,
    ),
    "предзаполненный вопрос имеет высоту по содержимому",
  );
  const emptyForm = await get(
    "/requests/new?type=question",
    timur.actor.userId,
  );
  check(
    !/<textarea[^>]*\[field-sizing:content\]/.test(emptyForm.text),
    "обычная пустая форма сохраняет прежнее поведение",
  );
  await get(formPath, timur.actor.userId);
  check(
    (
      await sql`select id from requests where student_id = ${timur.actor.studentId}`
    ).length === before.length,
    "GET и повтор не создают заявку",
  );
  for (const params of [
    `courseId=${course.id}`,
    `courseId=${course.id}&workId=${work.id}`,
    "courseId=00000000-0000-7000-8000-000000ffffee",
    "courseId=invalid",
    `courseId=${course.id}&courseId=invalid`,
    `courseId=${own.id}&workId=${work.id}`,
  ]) {
    for (const rsc of [false, true]) {
      const denied = await get(
        `/requests/new?type=question&${params}`,
        anna.actor.userId,
        rsc,
      );
      check(
        noForeignFacts(denied.text),
        "IDOR предзаполнения HTML/RSC без чужих фактов",
      );
      if (!rsc)
        check(
          /<textarea[^>]*name="question"[^>]*><\/textarea>/.test(denied.text),
          "пустая форма для чужого и отсутствующего id",
        );
    }
  }
  for (const workQuery of [
    `workId=${work.id}`,
    "workId=abc",
    "workId=00000000-0000-7000-8000-000000ffffee",
    `workId=${work.id}&workId=abc`,
  ]) {
    for (const rsc of [false, true]) {
      const ownDetail = await get(
        `/grades/${own.id}?actions=1&${workQuery}`,
        anna.actor.userId,
        rsc,
      );
      check(
        ownDetail.response.status === 200 && noForeignFacts(ownDetail.text),
        "своя дисциплина с посторонним workId — 200 без чужих фактов HTML/RSC",
      );
      if (rsc)
        check(
          ownDetail.response.headers
            .get("content-type")
            ?.includes("text/x-component"),
          "ответ проверки — RSC",
        );
      else
        check(
          /<details[^>]*id="course-actions"[^>]*open/.test(ownDetail.text) &&
            ownDetail.text.includes(`<h1>${own.title}</h1>`),
          "сохраняются заголовок и раскрытые варианты своей дисциплины",
        );
    }
  }
  const deniedDetail = await get(
    `${coursePath}?actions=1&workId=${work.id}`,
    anna.actor.userId,
  );
  check(
    deniedDetail.response.status === 404 && noForeignFacts(deniedDetail.text),
    "IDOR дисциплины — 404",
  );
  const missingDetail = await get(
    "/grades/00000000-0000-7000-8000-000000ffffee?workId=abc",
    anna.actor.userId,
  );
  check(
    missingDetail.response.status === 404,
    "отсутствующая дисциплина остаётся 404",
  );
  const deniedData = await get(`${coursePath}/data`, anna.actor.userId);
  check(
    deniedData.response.status === 404 &&
      deniedData.text.includes('"code":"NOT_FOUND"'),
    "IDOR API дисциплины — 404",
  );
  const manifest = JSON.parse(
    await readFile(".next/server/server-reference-manifest.json", "utf8"),
  ) as { node: Record<string, { exportedName: string; filename: string }> };
  async function action(name: string, input: unknown) {
    const id = Object.entries(manifest.node).find(
      ([, entry]) =>
        entry.exportedName === name &&
        entry.filename === "src/app/(student)/requests/actions.ts",
    )?.[0];
    if (!id) throw new Error("Не найдена Server Action сборки.");
    const response = await fetch(new URL(formPath, base), {
      method: "POST",
      headers: {
        Cookie: cookies.get(timur.actor.userId) ?? "",
        Origin: base,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Next-Action": id,
        "Content-Type": "application/json",
        Accept: "text/x-component",
      },
      body: JSON.stringify([input]),
    });
    const body = await response.text();
    check(
      response.status === 200 && body.includes('"ok":true'),
      "Server Action успешно выполнилась",
    );
  }
  const edited = `${question}\nХочу уточнить доступное время консультации.`;
  await action("saveRequestDraftAction", {
    typeCode: "question",
    payload: { question: edited },
    review: true,
  });
  const drafts = await sql<
    { id: string; status: string; payload: { question: string } }[]
  >`select id, status, payload from requests where student_id = ${timur.actor.studentId}`;
  check(
    drafts.length === before.length + 1 &&
      drafts[0]?.status === "draft" &&
      drafts[0]?.payload.question === edited,
    "Проверить сохраняет только проверенный черновик с правкой",
  );
  const requestId = drafts.find((item) => item.payload.question === edited)?.id;
  if (!requestId) throw new Error("Нет проверенного черновика.");
  await action("submitRequestAction", requestId);
  const tracker = await get(`/requests/${requestId}`, timur.actor.userId);
  check(
    tracker.response.status === 200 &&
      tracker.text.includes("Путь заявки") &&
      tracker.text.includes("Подана") &&
      tracker.text.includes("Хочу уточнить доступное время консультации."),
    "Отправить ведёт к трекеру с правкой",
  );
  const deniedRequest = await get(`/requests/${requestId}`, anna.actor.userId);
  check(
    deniedRequest.response.status === 404,
    "IDOR отправленной заявки — 404",
  );
  console.info(
    `HTTP TASK-31: ${checks}/${checks}, временные данные очищаются.`,
  );
} finally {
  try {
    await isolated?.close();
  } finally {
    await sql.end({ timeout: 1 });
    for (const student of students.reverse()) await student.close();
  }
}
