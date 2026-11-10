import assert from "node:assert/strict";
import { RenewCalendarToken } from "@/application/schedule/calendar";
import type { SearchDto } from "@/application/search/dto";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresSessionStore } from "@/infrastructure/db/repositories/identity/sessions";
import {
  PostgresCalendarTokenStore,
  PostgresScheduleRepository,
} from "@/infrastructure/db/repositories/schedule/repository";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { readDemoAccountCounts } from "./demo-account-counts";
import { openStudentTestData } from "./student-e2e-data";

const origin = `http://localhost:${process.env.PORT || "3000"}`;
const sql = createDatabase(1);
const before = await readDemoAccountCounts(sql);
const student = await openStudentTestData("anna");
const tokens = new CryptoSessionTokens();
const token = tokens.generate();
const ids = new UuidV7Generator();
let passed = 0;

async function get(path: string, language: "ru" | "en", html = true) {
  const response = await fetch(new URL(path, origin), {
    redirect: "manual",
    headers: {
      Accept: html ? "text/html" : "application/json",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": html ? "navigate" : "cors",
      "Sec-Fetch-Dest": html ? "document" : "empty",
      Cookie: `__Host-pulse-session=${token}; pulse-language=${language}`,
    },
  });
  const text = await response.text();
  assert(response.headers.get("cache-control")?.includes("no-store"));
  assert.equal(response.status, 200);
  if (html) {
    assert(text.includes(`<html lang="${language}"`));
    assert(
      response.headers
        .get("content-security-policy")
        ?.includes("'strict-dynamic'"),
    );
  }
  return { response, text };
}

try {
  const now = new Date();
  await new PostgresSessionStore(() => sql).create({
    id: ids.next(),
    userId: student.actor.userId,
    tokenHash: tokens.hash(token),
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
  });
  for (const language of ["ru", "en"] as const) {
    const english = language === "en";
    for (const view of ["today", "week"]) {
      const { text, response } = await get(`/schedule?view=${view}`, language);
      assert(
        text.includes(
          english
            ? '<h1 class="text-2xl font-semibold">Schedule</h1>'
            : '<h1 class="text-2xl font-semibold">Расписание</h1>',
        ),
      );
      assert(text.includes(english ? "Personal calendar" : "Личный календарь"));
      assert(
        text.includes(english ? "Get a new link" : "Получить новую ссылку"),
      );
      assert(text.includes('data-calendar-ready="false"'));
      const at = response.headers.get("date");
      assert(at);
      const date = new Intl.DateTimeFormat(english ? "en-GB" : "ru-RU", {
        timeZone: "Europe/Moscow",
        weekday: "long",
        day: "numeric",
        month: "long",
      }).format(new Date(at));
      const label = date.charAt(0).toLocaleUpperCase(language) + date.slice(1);
      assert(text.includes(label));
      if (view === "week") {
        assert(text.includes(english ? "Rescheduled from" : "Перенесено с"));
        assert(text.includes(english ? "No classes" : "Занятий нет"));
        assert(text.includes("Учебная встреча перенесена"));
        assert(text.includes("Политическая география"));
        assert(text.includes("ДЕМО-102"));
      }
      passed++;
    }
    const invalid = await get("/schedule?week=2026-W99", language);
    assert(
      invalid.text.includes(
        english ? "Could not select the week" : "Не удалось выбрать неделю",
      ),
    );
    passed++;
    for (const [q, ru, en] of [
      ["", "Начните со слова или номера", "Start with a word or number"],
      [
        "география",
        "Дисциплина · работы и оценки",
        "Course · assessments and grades",
      ],
      ["ДЕМО-102", "ауд.", "room"],
      ["эссе", "из 100", "out of 100"],
      ["академотпуск", "Положения", "Regulations"],
      ["щщщзз", "Ничего не найдено", "No results found"],
      [
        "а",
        "Введите запрос от 2 до 80 символов.",
        "Enter a query of 2–80 characters.",
      ],
      [
        "\nгеография",
        "Удалите управляющие символы из запроса.",
        "Remove control characters from your query.",
      ],
    ]) {
      assert(q !== undefined && ru !== undefined && en !== undefined);
      const { text } = await get(
        `/search?${new URLSearchParams({ q })}`,
        language,
      );
      assert(
        text.includes(english ? en : ru),
        `Поиск ${language}: ${english ? en : ru}`,
      );
      assert(
        text.includes(english ? "Search your portal" : "Поиск по кабинету"),
      );
      assert(text.includes('method="get"'));
      passed++;
    }
    for (const q of ["география", "щщщзз", "Основы маркетинга"]) {
      const { text } = await get(
        `/api/search/suggest?${new URLSearchParams({ q, studentId: "other", userId: "other" })}`,
        language,
        false,
      );
      const result = JSON.parse(text) as SearchDto;
      assert.equal(result.groups.length, 4);
      assert(
        result.groups.every(
          (group) => group.status === "ok" && !Object.hasOwn(group, "title"),
        ),
      );
      if (q === "география") {
        const item = result.groups[0]?.items[0];
        assert(item);
        assert.equal(item?.title, "Политическая география");
        assert.equal(item.context.code, "schedule");
        if (item.context.code === "schedule")
          assert(item.context.startsAt.endsWith("Z"));
      } else assert(result.groups.every((group) => group.items.length === 0));
      passed++;
    }
  }
  const calendar = await new RenewCalendarToken(
    new PostgresCalendarTokenStore(() => sql),
    tokens,
    ids,
    new PostgresScheduleRepository(() => sql),
  ).execute(student.actor);
  const russian = await get(calendar.path, "ru", false);
  const english = await get(calendar.path, "en", false);
  assert.equal(english.text, russian.text);
  assert(
    english.response.headers.get("content-type")?.includes("text/calendar"),
  );
  const unfolded = english.text.replaceAll("\r\n ", "");
  assert(unfolded.includes("X-WR-CALNAME:Пульс — расписание"));
  assert(unfolded.includes("SUMMARY:Политическая география"));
  assert(unfolded.includes("Учебная встреча перенесена"));
  passed++;
} finally {
  await student.close();
  assert.deepEqual(await readDemoAccountCounts(sql), before);
  await sql.end({ timeout: 1 });
}
console.log(
  `Production HTTP TASK-49: ${passed}/${passed}; временные данные очищены, демо-данные сохранены.`,
);
