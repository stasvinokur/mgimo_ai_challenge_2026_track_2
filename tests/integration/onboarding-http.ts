import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { OnboardingDto } from "@/application/onboarding/get-onboarding";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresSessionStore } from "@/infrastructure/db/repositories/identity/sessions";
import { readDemoAccountCounts } from "./demo-account-counts";
import { openStudentTestData, type StudentTestData } from "./student-e2e-data";
import { openTeacherTestData, type TeacherTestData } from "./teacher-e2e-data";

const origin = `http://127.0.0.1:${process.env.PORT || "3000"}`;
const sql = createDatabase(1);
const before = await readDemoAccountCounts(sql);
const students: StudentTestData[] = [];
const sessionIds: string[] = [];
let teacher: TeacherTestData | undefined;
let passed = 0;

async function session(userId: string) {
  const tokens = new CryptoSessionTokens();
  const token = tokens.generate();
  const id = randomUUID();
  const now = new Date().toISOString();
  await new PostgresSessionStore(() => sql).create({
    id,
    userId,
    tokenHash: tokens.hash(token),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  sessionIds.push(id);
  return token;
}

async function request(
  path: string,
  token?: string,
  input?: unknown,
  requestOrigin: string | null = origin,
) {
  const response = await fetch(new URL(path, origin), {
    redirect: "manual",
    method: input === undefined ? "GET" : "POST",
    headers: {
      Accept:
        path === "/today" || path === "/today/install"
          ? "text/html"
          : "application/json",
      ...(token ? { Cookie: `__Host-pulse-session=${token}` } : {}),
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
      ...(requestOrigin === null ? {} : { Origin: requestOrigin }),
      ...(input === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  return { response, text: await response.text() };
}

async function progress(token: string) {
  const { response, text } = await request("/api/me/onboarding", token);
  assert.equal(response.status, 200);
  assert(response.headers.get("cache-control")?.includes("no-store"));
  passed++;
  return JSON.parse(text) as OnboardingDto | null;
}

function completed(data: OnboardingDto | null, code: string) {
  return data?.steps.find((step) => step.code === code)?.completed;
}

try {
  for (const input of [
    undefined,
    { stepCode: "schedule" },
    { action: "hide" },
  ]) {
    const result = await request("/api/me/onboarding", undefined, input);
    assert.equal(result.response.status, 401);
    assert(result.response.headers.get("cache-control")?.includes("no-store"));
    assert(!result.text.includes('"steps"'));
    passed++;
  }
  for (const scenario of ["timur", "timur", "anna"] as const)
    students.push(await openStudentTestData(scenario));
  const [own, foreign, anna] = students;
  assert(own && foreign && anna);
  const ownToken = await session(own.actor.userId);
  const foreignToken = await session(foreign.actor.userId);
  const annaToken = await session(anna.actor.userId);
  const removed = await request("/today/onboarding", ownToken);
  assert.equal(removed.response.status, 404);
  assert(!removed.text.includes('"steps"'));
  passed++;
  const initial = await progress(ownToken);
  assert(initial);
  assert.equal(initial?.total, 5);
  assert.equal(initial.completed, 0);
  assert.deepEqual(
    initial.steps.map((step) => step.code),
    ["schedule", "calendar", "install", "regulations", "assistant"],
  );
  passed++;
  for (const [token, expected] of [
    [ownToken, true],
    [annaToken, false],
  ] as const) {
    const { response, text } = await request("/today", token);
    assert.equal(response.status, 200);
    assert.equal(text.includes('data-testid="onboarding-card"'), expected);
    if (expected) {
      assert(text.includes("Основы маркетинга — есть долг"));
      assert(text.includes('data-testid="today-action"'));
    }
    passed++;
  }
  assert.equal(await progress(annaToken), null);
  passed++;
  const foreignMark = await request("/api/me/onboarding", foreignToken, {
    stepCode: "regulations",
  });
  assert.equal(foreignMark.response.status, 200);
  const ownMark = await request("/api/me/onboarding", ownToken, {
    stepCode: "schedule",
  });
  assert.equal(ownMark.response.status, 200);
  const ownProgress = await progress(ownToken);
  assert.equal(completed(ownProgress, "schedule"), true);
  assert.equal(completed(ownProgress, "regulations"), false);
  assert.equal(completed(await progress(foreignToken), "schedule"), false);
  passed++;
  const renewedToken = await session(own.actor.userId);
  assert.deepEqual(await progress(renewedToken), ownProgress);
  passed++;
  for (const [key, id] of [
    ["userId", foreign.actor.userId],
    ["studentId", foreign.actor.studentId],
  ] as const) {
    const path = `/api/me/onboarding?${new URLSearchParams({ [key]: id })}`;
    for (const input of [undefined, { stepCode: "regulations" }]) {
      const result = await request(path, ownToken, input);
      assert.equal(result.response.status, 400);
      assert(!result.text.includes(id));
      passed++;
    }
    for (const input of [
      { stepCode: "regulations", [key]: id },
      { action: "hide", [key]: id },
    ]) {
      const result = await request("/api/me/onboarding", ownToken, input);
      assert.equal(result.response.status, 400);
      assert(!result.text.includes(id));
      passed++;
    }
    const direct = await request(`/api/me/onboarding/${id}`, ownToken);
    assert.equal(direct.response.status, 404);
    passed++;
  }
  for (const requestOrigin of [null, "https://foreign.example", "null"]) {
    for (const input of [{ stepCode: "install" }, { action: "hide" }]) {
      const result = await request(
        "/api/me/onboarding",
        ownToken,
        input,
        requestOrigin,
      );
      assert.equal(result.response.status, 403);
      assert(
        result.response.headers.get("cache-control")?.includes("no-store"),
      );
      passed++;
    }
  }
  assert.deepEqual(await progress(ownToken), ownProgress);
  passed++;
  const install = await request("/today/install", ownToken);
  assert.equal(install.response.status, 200);
  assert(install.text.includes("Подсказка установки появится"));
  assert(install.text.includes("К первым шагам"));
  assert.equal((install.text.match(/data-pwa-install/g) ?? []).length, 0);
  passed++;
  const [staff] = await sql<
    { id: string }[]
  >`select id from users where login = 'marina' and role = 'staff'`;
  assert(staff, "Нужен демо-сид сотрудника.");
  const staffToken = await session(staff.id);
  for (const input of [
    undefined,
    { stepCode: "schedule" },
    { action: "hide" },
  ]) {
    const result = await request("/api/me/onboarding", staffToken, input);
    assert.equal(result.response.status, 403);
    assert(result.response.headers.get("cache-control")?.includes("no-store"));
    assert(!result.text.includes('"steps"'));
    passed++;
  }
  teacher = await openTeacherTestData();
  const teacherToken = await session(teacher.actor.userId);
  for (const input of [
    undefined,
    { stepCode: "schedule" },
    { action: "hide" },
  ]) {
    const result = await request("/api/me/onboarding", teacherToken, input);
    assert.equal(result.response.status, 403);
    assert(result.response.headers.get("cache-control")?.includes("no-store"));
    assert(!result.text.includes('"steps"'));
    passed++;
  }
  const hidden = await request("/api/me/onboarding", ownToken, {
    action: "hide",
  });
  assert.equal(hidden.response.status, 200);
  assert.equal(JSON.parse(hidden.text), null);
  assert.equal(await progress(ownToken), null);
  assert.equal(await progress(renewedToken), null);
  const hiddenPage = await request("/today", renewedToken);
  assert.equal(hiddenPage.response.status, 200);
  assert(!hiddenPage.text.includes('data-testid="onboarding-card"'));
  assert.notEqual(await progress(foreignToken), null);
  passed++;
} finally {
  try {
    for (const id of sessionIds)
      await sql`delete from sessions where id = ${id}`;
    const cleanup = await Promise.allSettled([
      ...students.map((student) => student.close()),
      ...(teacher ? [teacher.close()] : []),
    ]);
    assert.equal(
      cleanup.filter((result) => result.status === "rejected").length,
      0,
      "Все временные пользователи должны быть удалены.",
    );
    assert.deepEqual(await readDemoAccountCounts(sql), before);
    passed++;
  } finally {
    await sql.end({ timeout: 1 });
  }
}
console.log(
  `Production HTTP onboarding: ${passed}/${passed}; временные данные удалены, демо-счётчики сохранены.`,
);
