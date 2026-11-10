import { readFileSync } from "node:fs";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { expect, it } from "vitest";
import * as schema from "../../src/infrastructure/db/schema";

const tables = Object.values(schema).filter((value) => is(value, PgTable));
const journal = JSON.parse(
  readFileSync(
    new URL("../../drizzle/meta/_journal.json", import.meta.url),
    "utf8",
  ),
) as { entries: { tag: string }[] };
const migration = journal.entries
  .map(({ tag }) =>
    readFileSync(new URL(`../../drizzle/${tag}.sql`, import.meta.url), "utf8"),
  )
  .join("\n");

it("в миграциях присутствуют все 37 таблиц модели и внешние ключи схемы", () => {
  expect(tables).toHaveLength(37);
  for (const table of tables) {
    const config = getTableConfig(table);
    expect(migration).toContain(`CREATE TABLE "${config.name}"`);
    for (const key of config.foreignKeys) {
      expect(migration).toContain(
        `ADD CONSTRAINT "${key.getName()}" FOREIGN KEY`,
      );
    }
  }
  expect(schema.students.userId.notNull).toBe(false);
  expect(schema.sessions.createdAt.notNull).toBe(true);
  expect(schema.sessions.createdAt.hasDefault).toBe(true);
  expect(schema.students.userId.isUnique).toBe(true);
  expect(schema.requests.publicNo.isUnique).toBe(true);
  expect(schema.certificates.requestId.isUnique).toBe(true);
  expect(schema.certificates.verifyCode.isUnique).toBe(true);
  expect(schema.teachers.userId.isUnique).toBe(true);
  expect(schema.userRole.enumValues).toEqual(["student", "staff", "teacher"]);
  expect(schema.attendanceStatus.enumValues).toEqual([
    "present",
    "excused",
    "absent",
  ]);
  expect(migration).toContain(
    'UNIQUE("student_id","slot_id","occurrence_date")',
  );
  expect(migration).toContain('UNIQUE("student_id","source_key")');
  expect(migration).toContain(
    '"attendance_codes"."code_hash" ~ \'^[a-f0-9]{64}$\'',
  );
});

it("поиск регламентов использует сохраняемый russian tsvector с GIN", () => {
  expect(migration).toContain(
    "GENERATED ALWAYS AS (to_tsvector('russian'::regconfig, title || ' ' || body)) STORED",
  );
  expect(migration).toContain('ON "regulation_chunks" USING gin ("tsv")');
});

it("индексы начинаются с владельца или области доступа", () => {
  for (const [table, column] of [
    [schema.sessions, "user_id"],
    [schema.students, "group_id"],
    [schema.students, "faculty_id"],
    [schema.scheduleSlots, "group_id"],
    [schema.scheduleChanges, "slot_id"],
    [schema.assessments, "group_id"],
    [schema.sessionsExams, "group_id"],
    [schema.requests, "student_id"],
    [schema.requestEvents, "request_id"],
    [schema.notifications, "user_id"],
    [schema.assistantLog, "user_id"],
    [schema.staffAuditLog, "staff_user_id"],
  ] as const) {
    const indexes = getTableConfig(table).indexes;
    expect(
      indexes.some((item) => {
        const first = item.config.columns[0];
        return first && "name" in first && first.name === column;
      }),
    ).toBe(true);
  }
  expect(migration).toContain('UNIQUE("student_id","assessment_id")');
});

it("вместо открытых паролей и токенов схема требует хэши", () => {
  expect(migration).toContain("like '$argon2id$%'");
  expect(
    migration.match(
      /CHECK \("[^"]+"\."token_hash" ~ '\^\[a-f0-9\]\{64\}\$'\)/g,
    ),
  ).toHaveLength(2);
  expect(schema.requestStatus.enumValues).toEqual([
    "draft",
    "submitted",
    "accepted",
    "in_progress",
    "needs_info",
    "ready",
    "issued",
    "rejected",
    "cancelled",
  ]);
});
