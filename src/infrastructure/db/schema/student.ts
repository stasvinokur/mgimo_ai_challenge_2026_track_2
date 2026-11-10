import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity";

export const scholarship = pgEnum("scholarship", [
  "none",
  "academic",
  "increased",
]);
export const faculties = pgTable("faculties", {
  id: uuid().primaryKey(),
  seedKey: text("seed_key").unique(),
  code: text().notNull().unique(),
  title: text().notNull(),
});
export const programs = pgTable(
  "programs",
  {
    id: uuid().primaryKey(),
    seedKey: text("seed_key").unique(),
    facultyId: uuid("faculty_id")
      .notNull()
      .references(() => faculties.id),
    title: text().notNull(),
  },
  (t) => [
    index("programs_faculty_idx").on(t.facultyId),
    unique("programs_title_unique").on(t.facultyId, t.title),
  ],
);
export const groups = pgTable(
  "groups",
  {
    id: uuid().primaryKey(),
    seedKey: text("seed_key").unique(),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id),
    title: text().notNull().unique(),
  },
  (t) => [index("groups_program_idx").on(t.programId)],
);
export const students = pgTable(
  "students",
  {
    id: uuid().primaryKey(),
    seedKey: text("seed_key").unique(),
    userId: uuid("user_id")
      .unique()
      .references(() => users.id),
    fullName: text("full_name").notNull(),
    facultyId: uuid("faculty_id")
      .notNull()
      .references(() => faculties.id),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id),
    course: integer().notNull(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id),
    recordBookNo: text("record_book_no").notNull().unique(),
    scholarship: scholarship().notNull().default("none"),
    targetScore: integer("target_score").notNull().default(70),
  },
  (t) => [
    index("students_faculty_idx").on(t.facultyId),
    index("students_group_idx").on(t.groupId),
    index("students_program_idx").on(t.programId),
    check("students_course", sql`${t.course} between 1 and 6`),
    check("students_target", sql`${t.targetScore} between 0 and 100`),
  ],
);
export const staff = pgTable("staff", {
  id: uuid().primaryKey(),
  seedKey: text("seed_key").unique(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id),
  fullName: text("full_name").notNull(),
});
export const staffFaculties = pgTable(
  "staff_faculties",
  {
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    facultyId: uuid("faculty_id")
      .notNull()
      .references(() => faculties.id),
  },
  (t) => [
    primaryKey({ columns: [t.staffId, t.facultyId] }),
    index("staff_faculties_faculty_idx").on(t.facultyId),
  ],
);
