import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresSessionStore } from "@/infrastructure/db/repositories/identity/sessions";
import { openStudentTestData } from "./student-e2e-data";

const origin = `http://localhost:${process.env.PORT || "3000"}`;
const student = await openStudentTestData("anna");
const sql = createDatabase(1);
const tokens = new CryptoSessionTokens();
const token = tokens.generate();
const at = new Date().toISOString();
const sessionId = randomUUID();
let passed = 0;

try {
  await new PostgresSessionStore(() => sql).create({
    id: sessionId,
    userId: student.actor.userId,
    tokenHash: tokens.hash(token),
    createdAt: at,
    lastSeenAt: at,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  for (const language of ["ru", "en"] as const) {
    const english = language === "en";
    const paths = [
      ["/notifications", english ? "Notifications" : "Уведомления"],
      ["/profile", english ? "Profile" : "Профиль"],
      [
        "/profile/assistant",
        english ? "My assistant journal" : "Мой журнал ассистента",
      ],
      [
        "/regulations",
        english ? "Dean’s office regulations" : "Положения деканата",
      ],
      ["/regulations/scholarship#p-2", "Стипендии"],
      ["/regulations?q=%00", english ? "1–200 characters" : "от 1 до 200"],
      [
        "/regulations?q=несуществующеесловоъ",
        english ? "No matching sections" : "Подходящих пунктов не найдено",
      ],
    ];
    for (const [path, expected] of paths) {
      assert(path && expected);
      const response = await fetch(new URL(path, origin), {
        redirect: "manual",
        headers: {
          Accept: "text/html",
          Origin: origin,
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Dest": "document",
          Cookie: `__Host-pulse-session=${token}; pulse-language=${language}`,
        },
      });
      assert.equal(response.status, 200, path);
      assert(response.headers.get("cache-control")?.includes("no-store"));
      const csp = response.headers.get("content-security-policy") ?? "";
      assert(csp.includes("'nonce-"));
      assert(csp.includes("'strict-dynamic'"));
      const html = (await response.text()).replace(
        /<script\b[^>]*>[\s\S]*?<\/script>/g,
        "",
      );
      assert(html.includes(`<html lang="${language}"`));
      assert(html.includes(expected), `${path}: перевод видимого HTML`);
      if (path.startsWith("/regulations") && english)
        assert(html.includes("texts are available in Russian"));
      if (path === "/profile") {
        assert(html.includes("Анна Соколова"));
        assert(html.includes(english ? "Passkeys" : "Ключи доступа"));
      }
      passed++;
    }
  }
} finally {
  await sql`delete from sessions where id = ${sessionId}`;
  await sql.end({ timeout: 1 });
  await student.close();
}
console.log(
  `Production HTTP TASK-52: ${passed}/${passed}; временные данные удалены.`,
);
