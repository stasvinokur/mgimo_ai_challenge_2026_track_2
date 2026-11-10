import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresSessionStore } from "@/infrastructure/db/repositories/identity/sessions";

const origin = `http://localhost:${process.env.PORT || "3000"}`;
const sql = createDatabase(1);
const sessionIds: string[] = [];
let passed = 0;

async function session(login: string) {
  const [user] = await sql<{ id: string }[]>`
    select id from users where login = ${login}`;
  assert(user, "Нужен демо-сид тестовой БД.");
  const tokens = new CryptoSessionTokens();
  const token = tokens.generate();
  const id = randomUUID();
  const now = new Date().toISOString();
  await new PostgresSessionStore(() => sql).create({
    id,
    userId: user.id,
    tokenHash: tokens.hash(token),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  sessionIds.push(id);
  return token;
}

async function page(path: string, language?: string, token?: string) {
  const response = await fetch(new URL(path, origin), {
    redirect: "manual",
    headers: {
      Accept: "text/html",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Dest": "document",
      Cookie: [
        ...(language ? [`pulse-language=${language}`] : []),
        ...(token ? [`__Host-pulse-session=${token}`] : []),
      ].join("; "),
    },
  });
  const html = await response.text();
  assert(response.headers.get("cache-control")?.includes("no-store"));
  const csp = response.headers.get("content-security-policy") ?? "";
  assert(csp.includes("'nonce-"));
  assert(csp.includes("'strict-dynamic'"));
  assert(!csp.includes("unsafe-eval"));
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  return { response, html };
}

try {
  for (const language of [undefined, "ru", "en", "EN", "en-US", "unknown"]) {
    const { response, html } = await page("/login", language);
    const english = language === "en";
    assert.equal(response.status, 200);
    assert(html.includes(`<html lang="${english ? "en" : "ru"}"`));
    assert(html.includes(english ? "Sign in to Pulse" : "Вход в «Пульс»"));
    assert(html.includes(english ? "Username" : "Логин"));
    const languageSelect = html.match(
      /<select\b[^>]*data-language-ready="false"[^>]*>/,
    )?.[0];
    assert(languageSelect?.includes('disabled=""'));
    assert(
      html.includes(
        english ? "Sign in with a passkey" : "Войти с ключом доступа",
      ),
    );
    assert(
      html.includes(english ? "All data is fictional" : "Все данные вымышлены"),
    );
    assert(!html.includes("injected"));
    passed++;
  }
  const student = await session("anna");
  for (const language of [undefined, "ru", "en", "unknown"]) {
    const english = language === "en";
    for (const path of ["/today", "/schedule", "/profile"]) {
      const { response, html } = await page(path, language, student);
      assert.equal(response.status, 200);
      assert(html.includes(`<html lang="${english ? "en" : "ru"}"`));
      assert(html.includes(english ? "Main navigation" : "Основная навигация"));
      assert(html.includes(english ? "Skip to content" : "К содержимому"));
      assert(html.includes(english ? "Switch theme" : "Переключить тему"));
      if (path === "/profile") {
        const languageSelect = html.match(
          /<select\b[^>]*data-language-ready="false"[^>]*>/,
        )?.[0];
        assert(languageSelect?.includes('disabled=""'));
        assert(html.includes(english ? "Larger text" : "Крупный текст"));
        assert(html.includes(english ? "Language" : "Язык"));
      }
      passed++;
    }
  }
  for (const language of ["ru", "en"]) {
    const { response, html } = await page("/i18n-missing", language, student);
    assert.equal(response.status, 404);
    assert(
      html.includes(
        language === "en" ? "Page not found" : "Страница не найдена",
      ),
    );
    passed++;
  }
  for (const [login, path, title] of [
    ["marina", "/staff/requests", "Заявки студентов"],
    ["oleg", "/teacher", "Мои пары"],
  ]) {
    assert(login && path && title);
    const token = await session(login);
    const { response, html } = await page(path, "en", token);
    assert.equal(response.status, 200);
    assert(html.includes(title));
    assert(html.includes('lang="ru"'));
    assert(html.includes("This interface is available in Russian."));
    passed++;
  }
} finally {
  try {
    for (const id of sessionIds)
      await sql`delete from sessions where id = ${id}`;
  } finally {
    await sql.end({ timeout: 1 });
  }
}
console.log(
  `Production HTTP i18n: ${passed}/${passed}; временные сессии удалены.`,
);
