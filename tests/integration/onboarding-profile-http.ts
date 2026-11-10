import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { OnboardingDto } from "@/application/onboarding/get-onboarding";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresSessionStore } from "@/infrastructure/db/repositories/identity/sessions";
import { readDemoAccountCounts } from "./demo-account-counts";
import { openStudentTestData } from "./student-e2e-data";

const origin = `http://localhost:${process.env.PORT || "3000"}`;
const destinations = {
  schedule: "/schedule?view=week",
  calendar: "/schedule",
  install: "/today/install",
  regulations: "/regulations?q=стипендия",
  assistant: "/profile/assistant",
  push: "/profile#push-notifications",
  passkey: "/profile#passkeys",
};
const sql = createDatabase(1);
const before = await readDemoAccountCounts(sql);
const sessionId = randomUUID();
let student: Awaited<ReturnType<typeof openStudentTestData>> | undefined;
let passed = 0;

try {
  student = await openStudentTestData("timur");
  const tokens = new CryptoSessionTokens();
  const token = tokens.generate();
  const now = new Date().toISOString();
  await new PostgresSessionStore(() => sql).create({
    id: sessionId,
    userId: student.actor.userId,
    tokenHash: tokens.hash(token),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });

  async function request(path: string, language: "ru" | "en") {
    const api = path.startsWith("/api/");
    const response = await fetch(new URL(path, origin), {
      redirect: "manual",
      headers: {
        Accept: api ? "application/json" : "text/html",
        Cookie: `__Host-pulse-session=${token}; pulse-language=${language}`,
        Origin: origin,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": api ? "cors" : "navigate",
        "Sec-Fetch-Dest": api ? "empty" : "document",
      },
    });
    const body = await response.text();
    assert.equal(response.status, 200, `${path}: ожидается HTTP 200`);
    passed++;
    return body;
  }

  for (const language of ["ru", "en"] as const) {
    const progress = JSON.parse(
      await request("/api/me/onboarding", language),
    ) as OnboardingDto;
    assert.deepEqual(
      progress.steps.map(({ code }) => code),
      Object.keys(destinations),
      "Для проверки нужны настроенные push и ключи доступа на localhost.",
    );
    passed++;
    const today = await request("/today", language);
    const links = Object.fromEntries(
      [
        ...today.matchAll(
          /data-onboarding-step="([^"]+)"[\s\S]*?<a [^>]*href="([^"]+)"/g,
        ),
      ].map((match) => [match[1], match[2]]),
    );
    assert.deepEqual(
      links,
      destinations,
      "Каждый шаг ведёт к месту выполнения.",
    );
    passed++;

    const profile = await request(destinations.push, language);
    for (const anchor of ["push-notifications", "passkeys"]) {
      const target = profile.match(
        new RegExp(`<[^>]+id="${anchor}"[^>]*>`),
      )?.[0];
      assert(target, `Карточка ${anchor} имеет якорь.`);
      assert.match(target, /class="[^"]*\bscroll-mt-24\b/);
      assert(target.includes('data-profile-anchor-ready="false"'));
    }
    assert(
      profile.includes(
        language === "ru" ? "Уведомления на телефон" : "Phone notifications",
      ),
    );
    passed++;
    const passkeys = await request(destinations.passkey, language);
    assert(
      passkeys.includes('name="deviceName"'),
      "В профиле есть форма добавления ключа.",
    );
    passed++;

    const schedule = await request(destinations.schedule, language);
    assert(
      schedule.includes("data-calendar-ready"),
      "В расписании есть управление подпиской на календарь.",
    );
    await request(destinations.calendar, language);
    const install = await request(destinations.install, language);
    assert(
      install.includes('href="/today"'),
      "Инструкция установки возвращает к шагам.",
    );
    const regulations = await request(destinations.regulations, language);
    assert(
      regulations.includes('id="regulation-query"'),
      "Поиск положения доступен.",
    );
    await request(destinations.assistant, language);

    const styles = [
      ...profile.matchAll(/<link[^>]*href="([^"]+\.css(?:\?[^"]*)?)"[^>]*>/g),
    ];
    assert(styles.length > 0, "Страница подключает локальные стили.");
    let css = "";
    for (const match of styles) {
      const href = match[1];
      assert(href, "У таблицы стилей есть адрес.");
      assert(href.startsWith("/"), "Стили должны быть локальными.");
      const response = await fetch(new URL(href, origin));
      assert.equal(response.status, 200, "CSS доступен в production-сборке.");
      css += await response.text();
      passed++;
    }
    assert.match(
      css,
      /\.scroll-mt-24\s*\{[^}]*scroll-margin-top:\s*calc\(var\(--spacing\)\s*\*\s*24\)/,
    );
    passed++;
  }
} finally {
  try {
    await sql`delete from sessions where id = ${sessionId}`;
    await student?.close();
    assert.deepEqual(await readDemoAccountCounts(sql), before);
    passed++;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

console.log(
  `Production HTTP: ссылки онбординга и якоря профиля — ${passed}/${passed}; временные данные удалены, демо-счётчики сохранены. Геометрия проверяется браузерным e2e.`,
);
