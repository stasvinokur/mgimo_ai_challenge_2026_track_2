import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity";
import { courses, rooms } from "./schedule";
import { groups, students } from "./student";

export const assessmentKind = pgEnum("assessment_kind", [
  "control",
  "essay",
  "test",
  "exam",
  "credit",
]);
export const examKind = pgEnum("exam_kind", ["exam", "credit"]);
export const assessments = pgTable(
  "assessments",
  {
    id: uuid().primaryKey(),
    seedKey: text("seed_key").unique(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id),
    kind: assessmentKind().notNull(),
    title: text().notNull(),
    weight: integer().notNull(),
    maxScore: integer("max_score").notNull(),
    isRequired: boolean("is_required").notNull().default(false),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("assessments_group_due_idx").on(t.groupId, t.dueAt),
    index("assessments_course_group_idx").on(t.courseId, t.groupId),
    check("assessments_weight", sql`${t.weight} > 0 and ${t.weight} <= 100`),
    check("assessments_max_score", sql`${t.maxScore} > 0`),
  ],
);
export const scores = pgTable(
  "scores",
  {
    id: uuid().primaryKey(),
    seedKey: text("seed_key").unique(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id),
    score: integer(),
    gradedAt: timestamp("graded_at", { withTimezone: true }),
  },
  (t) => [
    unique("scores_student_assessment_unique").on(t.studentId, t.assessmentId),
    index("scores_assessment_idx").on(t.assessmentId),
    check("scores_nonnegative", sql`${t.score} is null or ${t.score} >= 0`),
  ],
);
export const sessionsExams = pgTable(
  "sessions_exams",
  {
    id: uuid().primaryKey(),
    seedKey: text("seed_key").unique(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id),
    kind: examKind().notNull(),
    at: timestamp({ withTimezone: true }).notNull(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id),
  },
  (t) => [index("sessions_exams_group_at_idx").on(t.groupId, t.at)],
);

export const scoreEvents = pgTable(
  "score_events",
  {
    id: uuid().primaryKey(),
    seedKey: text("seed_key").unique(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    // Account owners cascade independently of profiles without a login.
    studentUserId: uuid("student_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    previousScore: integer("previous_score"),
    newScore: integer("new_score").notNull(),
    changedByUserId: uuid("changed_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("score_events_student_created_idx").on(t.studentId, t.createdAt),
    index("score_events_assessment_idx").on(t.assessmentId),
    index("score_events_author_idx").on(t.changedByUserId),
    index("score_events_user_idx").on(t.studentUserId),
    check("score_events_reason_length", sql`char_length(${t.reason}) <= 300`),
    check(
      "score_events_change_reason",
      sql`${t.previousScore} is null or (${t.reason} is not null and length(trim(${t.reason})) > 0)`,
    ),
    check(
      "score_events_nonnegative",
      sql`${t.newScore} >= 0 and (${t.previousScore} is null or ${t.previousScore} >= 0)`,
    ),
  ],
);
