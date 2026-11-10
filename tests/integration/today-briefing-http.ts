import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresSessionStore } from "@/infrastructure/db/repositories/identity/sessions";
import { readDemoAccountCounts } from "./demo-account-counts";
import { openStudentTestData, type StudentTestData } from "./student-e2e-data";

const origin = `http://127.0.0.1:${process.env.PORT || "3000"}`;
const sql = createDatabase(1);
const before = await readDemoAccountCounts(sql);
const students: StudentTestData[] = [];
let passed = 0;

async function session(student: StudentTestData) {
  const tokens = new CryptoSessionTokens();
  const token = tokens.generate();
  const now = new Date().toISOString();
  await new PostgresSessionStore(() => sql).create({
    id: randomUUID(),
    userId: student.actor.userId,
    tokenHash: tokens.hash(token),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  return token;
}

async function get(path: string, token?: string, rsc = false) {
  const response = await fetch(new URL(path, origin), {
    redirect: "manual",
    headers: {
      Accept: rsc ? "text/x-component" : "text/html",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": rsc ? "cors" : "navigate",
      "Sec-Fetch-Dest": rsc ? "empty" : "document",
      ...(token ? { Cookie: `__Host-pulse-session=${token}` } : {}),
      ...(rsc
        ? {
            RSC: "1",
            "Next-Router-State-Tree": encodeURIComponent(
              JSON.stringify([
                "",
                {
                  children: [
                    "(student)",
                    {
                      children: [
                        "today",
                        { children: ["__PAGE__", {}, null, "refetch"] },
                      ],
                    },
                  ],
                },
              ]),
            ),
          }
        : {}),
    },
  });
  const text = await response.text();
  const location = response.headers.get("location");
  if (rsc && response.status === 307 && location) {
    const target = new URL(location, origin);
    if (
      target.origin === origin &&
      target.pathname === "/today" &&
      target.searchParams.has("_rsc") &&
      !new URL(path, origin).searchParams.has("_rsc")
    )
      return get(`${target.pathname}${target.search}`, token, true);
  }
  return { response, text };
}

function card(text: string) {
  const result =
    /data-testid="today-briefing"([\s\S]*?)data-testid="briefing-status"/.exec(
      text,
    )?.[1];
  assert(result, "Карточка сводки должна присутствовать в серверном HTML.");
  return result;
}

try {
  for (const scenario of ["anna", "timur"] as const)
    students.push(await openStudentTestData(scenario));
  const anna = students[0],
    timur = students[1];
  assert(anna && timur);
  const annaToken = await session(anna),
    timurToken = await session(timur);
  for (const [token, own, foreign] of [
    [annaToken, "Иностранный язык", "Основы маркетинга"],
    [timurToken, "Основы маркетинга", "Иностранный язык"],
  ] as const) {
    const { response, text } = await get("/today", token);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    passed++;
    const briefing = card(text);
    assert(briefing.includes("Сводка дня"));
    const phrases = briefing.match(/data-testid="briefing-phrase"/g) ?? [];
    assert(phrases.length >= 3 && phrases.length <= 5);
    passed++;
    assert(briefing.includes(own));
    assert(!briefing.includes(foreign));
    passed++;
    assert(briefing.includes("Спросить подробнее"));
    assert(briefing.includes("Сводку можно прочитать"));
    assert(!briefing.includes("Послушать"));
    assert(!briefing.includes("Что можно сделать?"));
    passed++;
    if (own === "Основы маркетинга") {
      assert.equal((briefing.match(/долг/g) ?? []).length, 1);
      passed++;
    } else {
      assert(briefing.includes("перенесено"));
      assert(!briefing.includes("Главное: Пара перенесена."));
      assert(briefing.includes("77 из 100"));
      passed++;
    }
  }
  const path = `/today?studentId=${timur.actor.studentId}&userId=${timur.actor.userId}`;
  for (const rsc of [false, true]) {
    const { response, text } = await get(path, annaToken, rsc);
    assert.equal(response.status, 200);
    assert(text.includes("Иностранный язык"));
    assert(!text.includes("Основы маркетинга"));
    passed++;
  }
  const anonymous = await get("/today");
  assert.equal(anonymous.response.status, 307);
  assert(anonymous.response.headers.get("location")?.includes("/login"));
  passed++;
} finally {
  try {
    for (const student of students) await student.close();
    assert.deepEqual(await readDemoAccountCounts(sql), before);
    passed++;
  } finally {
    await sql.end({ timeout: 1 });
  }
}
console.log(
  `Production HTTP: ${passed}/${passed}; временные данные удалены, демо-счётчики сохранены.`,
);
