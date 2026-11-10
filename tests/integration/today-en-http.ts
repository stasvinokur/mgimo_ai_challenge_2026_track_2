import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { OnboardingDto } from "@/application/onboarding/get-onboarding";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresSessionStore } from "@/infrastructure/db/repositories/identity/sessions";
import { formatDate } from "@/ui/i18n/format";
import { readDemoAccountCounts } from "./demo-account-counts";
import { openStudentTestData, type StudentTestData } from "./student-e2e-data";

const origin = `http://localhost:${process.env.PORT || "3000"}`;
const sql = createDatabase(1);
const before = await readDemoAccountCounts(sql);
const students: StudentTestData[] = [];
const windowId = randomUUID();
let passed = 0;

async function session(userId: string) {
  const tokens = new CryptoSessionTokens();
  const token = tokens.generate();
  const now = new Date().toISOString();
  await new PostgresSessionStore(() => sql).create({
    id: randomUUID(),
    userId,
    tokenHash: tokens.hash(token),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  return token;
}

async function request(
  path: string,
  language?: string,
  token?: string,
  input?: unknown,
) {
  const response = await fetch(new URL(path, origin), {
    redirect: "manual",
    method: input === undefined ? "GET" : "POST",
    headers: {
      Accept: path.startsWith("/api/") ? "application/json" : "text/html",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": input === undefined ? "navigate" : "cors",
      "Sec-Fetch-Dest": input === undefined ? "document" : "empty",
      Cookie: [
        ...(language ? [`pulse-language=${language}`] : []),
        ...(token ? [`__Host-pulse-session=${token}`] : []),
      ].join("; "),
      ...(input === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  const text = await response.text();
  assert(response.headers.get("cache-control")?.includes("no-store"));
  return {
    response,
    text,
    html: text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ""),
  };
}

try {
  students.push(
    await openStudentTestData("anna"),
    await openStudentTestData("timur"),
  );
  const [anna, timur] = students;
  assert(anna && timur);
  const annaToken = await session(anna.actor.userId),
    timurToken = await session(timur.actor.userId);
  for (const [token, own, foreign, firstSteps] of [
    [annaToken, "Иностранный язык", "Основы маркетинга", false],
    [timurToken, "Основы маркетинга", "История международных отношений", true],
  ] as const) {
    for (const language of [undefined, "ru", "en", "unknown"]) {
      const english = language === "en";
      const { response, html } = await request("/today", language, token);
      assert.equal(response.status, 200);
      assert(html.includes(`<html lang="${english ? "en" : "ru"}"`));
      assert(html.includes(`<h1>${english ? "Today" : "Сегодня"}</h1>`));
      assert(html.includes(english ? "Day pulse" : "Пульс дня"));
      assert(html.includes(english ? "Day briefing" : "Сводка дня"));
      assert(html.includes(english ? "Needs action" : "Требует действия"));
      assert(html.includes(english ? "What&#x27;s next" : "Что дальше"));
      assert(html.includes(own));
      assert(!html.includes(foreign), "Нет дисциплины другой группы.");
      assert.equal(html.includes('data-testid="onboarding-card"'), firstSteps);
      if (firstSteps)
        assert(html.includes(english ? "First steps" : "Первые шаги"));
      const phrases = html.match(/data-testid="briefing-phrase"/g) ?? [];
      assert(phrases.length >= 3 && phrases.length <= 5);
      if (english) {
        assert(html.includes("Speech is not available in this browser"));
        assert(html.match(/<button[^>]*disabled=""[^>]*>Listen<\/button>/));
      }
      passed++;
    }
    const { response, html } = await request("/today/install", "en", token);
    assert.equal(response.status, 200);
    assert(html.includes("Install Pulse on your phone"));
    passed++;
  }
  for (const language of ["en", "ru"]) {
    const { response, html } = await request(
      `/today?studentId=${timur.actor.studentId}&userId=${timur.actor.userId}`,
      language,
      annaToken,
    );
    assert.equal(response.status, 200);
    assert(html.includes("Иностранный язык"));
    assert(!html.includes("Основы маркетинга"));
    passed++;
  }

  const [ready] = await sql<
    { id: string }[]
  >`select id from requests where student_id = ${anna.actor.studentId} and status = 'ready' limit 1`;
  assert(ready);
  await sql`insert into pickup_windows (id, faculty_id, title, opens_at, closes_at) values (${windowId}, ${anna.actor.facultyId}, 'Окно для проверки', '09:00', '17:00')`;
  const startsAt = new Date(
    Math.ceil(Date.now() / 600_000) * 600_000,
  ).toISOString();
  await sql`insert into pickup_bookings (id, user_id, request_id, window_id, slot_starts_at, ticket_no, status) values (${randomUUID()}, ${anna.actor.userId}, ${ready.id}, ${windowId}, ${startsAt}::timestamptz, 'Т-EN-48', 'called')`;
  for (const [token, hasTicket] of [
    [annaToken, true],
    [timurToken, false],
  ] as const) {
    const { html } = await request("/today", "en", token);
    assert.equal(html.includes("Т-EN-48"), hasTicket);
    if (hasTicket) {
      assert(html.includes("Please come to Окно для проверки"));
      assert(
        html.includes(
          formatDate("en", startsAt, { hour: "2-digit", minute: "2-digit" }),
        ),
      );
      assert(
        html.includes(
          formatDate("en", startsAt, {
            day: "numeric",
            month: "long",
            weekday: "short",
          }),
        ),
      );
    }
    passed++;
  }
  const progress = await request("/api/me/onboarding", "en", timurToken);
  assert.equal(progress.response.status, 200);
  const dto = JSON.parse(progress.text) as OnboardingDto;
  assert(
    dto.steps.every(
      (step) =>
        Object.keys(step).sort().join(",") === "automatic,code,completed",
    ),
  );
  passed++;
  const mutation = await request("/api/me/onboarding", "en", timurToken, {
    stepCode: "schedule",
  });
  assert.equal(mutation.response.status, 200);
  assert(
    (JSON.parse(mutation.text) as OnboardingDto).steps.some(
      (step) => step.code === "schedule" && step.completed,
    ),
  );
  passed++;
  for (const path of ["/today", "/today/install"]) {
    const { response } = await request(path, "en");
    assert.equal(response.status, 307);
    assert(response.headers.get("location")?.includes("/login"));
    passed++;
  }
} finally {
  try {
    await sql`delete from pickup_bookings where window_id = ${windowId}`;
    await sql`delete from pickup_windows where id = ${windowId}`;
    for (const student of students) await student.close();
    assert.deepEqual(await readDemoAccountCounts(sql), before);
    passed++;
  } finally {
    await sql.end({ timeout: 1 });
  }
}
console.log(
  `Production HTTP today English: ${passed}/${passed}; временные данные удалены, демо-счётчики сохранены.`,
);
