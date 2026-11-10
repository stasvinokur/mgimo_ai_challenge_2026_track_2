import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity";
import { groups, students } from "./student";

export const slotKind = pgEnum("slot_kind", ["lecture", "seminar", "exam"]);
export const weekParity = pgEnum("week_parity", ["any", "odd", "even"]);
export const changeKind = pgEnum("change_kind", [
  "moved",
  "room",
  "cancelled",
  "replaced",
]);
export const teachers = pgTable("teachers", {
  id: uuid().primaryKey(),
  seedKey: text("seed_key").unique(),
  userId: uuid("user_id")
    .unique()
    .references(() => users.id),
  fullName: text("full_name").notNull(),
});
export const courses = pgTable("courses", {
  id: uuid().primaryKey(),
  seedKey: text("seed_key").unique(),
  title: text().notNull(),
});
export const rooms = pgTable("rooms", {
  id: uuid().primaryKey(),
  seedKey: text("seed_key").unique(),
  title: text().notNull().unique(),
  building: text().notNull(),
});
export const scheduleSlots = pgTable(
  "schedule_slots",
  {
    id: uuid().primaryKey(),
    seedKey: text("seed_key").unique(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teachers.id),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id),
    weekday: integer().notNull(),
    startsAt: time("starts_at").notNull(),
    endsAt: time("ends_at").notNull(),
    kind: slotKind().notNull(),
    weekParity: weekParity("week_parity").notNull().default("any"),
  },
  (t) => [
    index("schedule_slots_group_day_idx").on(t.groupId, t.weekday),
    check("schedule_slots_weekday", sql`${t.weekday} between 1 and 7`),
    check("schedule_slots_time", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);
export const scheduleChanges = pgTable(
  "schedule_changes",
  {
    id: uuid().primaryKey(),
    seedKey: text("seed_key").unique(),
    slotId: uuid("slot_id")
      .notNull()
      .references(() => scheduleSlots.id),
    date: date().notNull(),
    kind: changeKind().notNull(),
    oldStartsAt: time("old_starts_at"),
    oldEndsAt: time("old_ends_at"),
    oldRoomId: uuid("old_room_id").references(() => rooms.id),
    oldTeacherId: uuid("old_teacher_id").references(() => teachers.id),
    newDate: date("new_date"),
    newStartsAt: time("new_starts_at"),
    newEndsAt: time("new_ends_at"),
    newRoomId: uuid("new_room_id").references(() => rooms.id),
    newTeacherId: uuid("new_teacher_id").references(() => teachers.id),
    reason: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("schedule_changes_slot_date_idx").on(t.slotId, t.date)],
);
export const calendarTokens = pgTable(
  "calendar_tokens",
  {
    id: uuid().primaryKey(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
  },
  (t) => [
    unique("calendar_tokens_student_unique").on(t.studentId),
    check("calendar_tokens_sha256", sql`${t.tokenHash} ~ '^[a-f0-9]{64}$'`),
  ],
);
