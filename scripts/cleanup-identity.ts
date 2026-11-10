import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "postgres";
import {
  REQUEST_SUBMISSION_KEY_PREFIX,
  REQUEST_SUBMISSION_WINDOW_SEC,
} from "../src/application/requests/submission-limit";
import {
  LOGIN_WINDOW_SEC,
  SESSION_ABSOLUTE_TTL_MS,
} from "../src/domain/identity/session-policy";
import { createDatabase } from "../src/infrastructure/db/client";

export async function cleanupIdentity(sql: Sql, now = new Date()) {
  return sql.begin(async (transaction) => {
    const sessions =
      await transaction`delete from sessions where expires_at <= ${now.toISOString()}::timestamptz or created_at <= ${new Date(now.getTime() - SESSION_ABSOLUTE_TTL_MS).toISOString()}::timestamptz`;
    // Retain the longest window for this prefix; all other rules expire within the login window.
    const submissionPrefix = `${REQUEST_SUBMISSION_KEY_PREFIX}:%`;
    const attempts = await transaction`delete from login_attempts where
        (key like ${submissionPrefix} and at <= ${new Date(now.getTime() - REQUEST_SUBMISSION_WINDOW_SEC * 1000).toISOString()}::timestamptz)
        or (key not like ${submissionPrefix} and at <= ${new Date(now.getTime() - LOGIN_WINDOW_SEC * 1000).toISOString()}::timestamptz)`;
    const assistantLogs =
      await transaction`delete from assistant_log where at < ${new Date(now.getTime() - 14 * 86_400_000).toISOString()}::timestamptz`;
    const attendanceCodes =
      await transaction`delete from attendance_codes where expires_at <= ${now.toISOString()}::timestamptz`;
    await transaction`delete from webauthn_challenges where used_at is not null or expires_at <= ${now.toISOString()}::timestamptz`;
    return {
      sessions: sessions.count,
      attempts: attempts.count,
      assistantLogs: assistantLogs.count,
      attendanceCodes: attendanceCodes.count,
    };
  });
}

async function main() {
  const sql = createDatabase(1);
  try {
    const result = await cleanupIdentity(sql);
    console.info(
      `Очистка завершена: сессий — ${result.sessions}, попыток входа — ${result.attempts}, записей ассистента — ${result.assistantLogs}, кодов отметки — ${result.attendanceCodes}.`,
    );
  } finally {
    await sql.end({ timeout: 1 });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    console.error(
      "Не удалось очистить истёкшие сессии и попытки входа. Проверьте доступность БД.",
    );
    process.exitCode = 1;
  });
}
