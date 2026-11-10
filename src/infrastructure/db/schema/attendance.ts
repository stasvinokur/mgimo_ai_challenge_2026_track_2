import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { scheduleSlots, teachers } from "./schedule";
import { students } from "./student";

export const attendanceStatus = pgEnum("attendance_status", [
  "present",
  "excused",
  "absent",
]);
export const attendanceSource = pgEnum("attendance_source", [
  "qr",
  "excuse",
  "demo",
]);

export const attendanceRecords = pgTable(
  "attendance_records",
  {
    id: uuid().primaryKey(),
    seedKey: text("seed_key").unique(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    slotId: uuid("slot_id")
      .notNull()
      .references(() => scheduleSlots.id),
    occurrenceDate: date("occurrence_date").notNull(),
    status: attendanceStatus().notNull(),
    source: attendanceSource().notNull(),
    sourceKey: text("source_key").notNull(),
    reason: text(),
    markedAt: timestamp("marked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("attendance_student_lesson_unique").on(
      t.studentId,
      t.slotId,
      t.occurrenceDate,
    ),
    index("attendance_lesson_idx").on(t.slotId, t.occurrenceDate),
    check(
      "attendance_excused_reason",
      sql`${t.status} <> 'excused' or length(trim(${t.reason})) > 0 and ${t.reason} is not null`,
    ),
    check("attendance_reason_length", sql`char_length(${t.reason}) <= 300`),
  ],
);

export const attendanceCodes = pgTable(
  "attendance_codes",
  {
    id: uuid().primaryKey(),
    slotId: uuid("slot_id")
      .notNull()
      .references(() => scheduleSlots.id),
    occurrenceDate: date("occurrence_date").notNull(),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teachers.id),
    codeHash: text("code_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("attendance_codes_lesson_idx").on(t.slotId, t.occurrenceDate),
    index("attendance_codes_expiry_idx").on(t.expiresAt),
    check("attendance_codes_sha256", sql`${t.codeHash} ~ '^[a-f0-9]{64}$'`),
    check("attendance_codes_lifetime", sql`${t.expiresAt} > ${t.createdAt}`),
    check(
      "attendance_codes_max_lifetime",
      sql`${t.expiresAt} <= ${t.createdAt} + interval '2 minutes'`,
    ),
  ],
);

export const activityPoints = pgTable(
  "activity_points",
  {
    id: uuid().primaryKey(),
    seedKey: text("seed_key").unique(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    sourceKey: text("source_key").notNull(),
    points: integer().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("activity_student_source_unique").on(t.studentId, t.sourceKey),
    check("activity_points_positive", sql`${t.points} > 0`),
  ],
);
