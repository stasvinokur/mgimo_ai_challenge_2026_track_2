import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity";
import { faculties, staff, students } from "./student";

export const requestStatus = pgEnum("request_status", [
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
export const delivery = pgEnum("request_delivery", ["pdf", "pickup"]);
export const requestTypes = pgTable(
  "request_types",
  {
    code: text().primaryKey(),
    seedKey: text("seed_key").unique(),
    title: text().notNull(),
    description: text().notNull(),
    slaWorkDays: integer("sla_work_days").notNull(),
    delivery: delivery().notNull(),
    fieldsSchema: jsonb("fields_schema")
      .$type<Record<string, unknown>>()
      .notNull(),
    isCertificate: boolean("is_certificate").notNull(),
  },
  (t) => [check("request_types_sla", sql`${t.slaWorkDays} > 0`)],
);
export const requests = pgTable(
  "requests",
  {
    id: uuid().primaryKey(),
    seedKey: text("seed_key").unique(),
    publicNo: text("public_no").notNull().unique(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id),
    typeCode: text("type_code")
      .notNull()
      .references(() => requestTypes.code),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    status: requestStatus().notNull().default("draft"),
    assigneeStaffId: uuid("assignee_staff_id").references(() => staff.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("requests_student_created_idx").on(t.studentId, t.createdAt),
    index("requests_status_due_idx").on(t.status, t.dueAt),
    index("requests_assignee_idx").on(t.assigneeStaffId),
    index("requests_type_idx").on(t.typeCode),
  ],
);
export const requestEvents = pgTable(
  "request_events",
  {
    id: uuid().primaryKey(),
    seedKey: text("seed_key").unique(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    fromStatus: requestStatus("from_status"),
    toStatus: requestStatus("to_status").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    comment: text(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("request_events_request_at_idx").on(t.requestId, t.at),
    index("request_events_actor_idx").on(t.actorUserId),
  ],
);

export const pickupWindows = pgTable(
  "pickup_windows",
  {
    id: uuid().primaryKey(),
    seedKey: text("seed_key").unique(),
    facultyId: uuid("faculty_id")
      .notNull()
      .references(() => faculties.id),
    title: text().notNull(),
    opensAt: time("opens_at").notNull(),
    closesAt: time("closes_at").notNull(),
  },
  (t) => [
    index("pickup_windows_faculty_idx").on(t.facultyId),
    check("pickup_windows_hours", sql`${t.closesAt} > ${t.opensAt}`),
  ],
);

export const pickupBookingStatus = pgEnum("pickup_booking_status", [
  "booked",
  "called",
  "served",
  "cancelled",
  "no_show",
]);

export const pickupBookings = pgTable(
  "pickup_bookings",
  {
    id: uuid().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    windowId: uuid("window_id")
      .notNull()
      .references(() => pickupWindows.id),
    slotStartsAt: timestamp("slot_starts_at", { withTimezone: true }).notNull(),
    ticketNo: text("ticket_no").notNull(),
    status: pickupBookingStatus().notNull().default("booked"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("pickup_bookings_user_idx").on(t.userId),
    index("pickup_bookings_window_day_idx").on(t.windowId, t.slotStartsAt),
    index("pickup_bookings_request_idx").on(t.requestId),
    // Active reservations alone occupy the slot and the request.
    uniqueIndex("pickup_bookings_active_slot_unique")
      .on(t.windowId, t.slotStartsAt)
      .where(sql`${t.status} in ('booked', 'called')`),
    uniqueIndex("pickup_bookings_active_request_unique")
      .on(t.requestId)
      .where(sql`${t.status} in ('booked', 'called')`),
    check(
      "pickup_bookings_ten_minute_slot",
      sql`mod(extract(epoch from ${t.slotStartsAt}), 600) = 0`,
    ),
    check("pickup_bookings_ticket", sql`length(trim(${t.ticketNo})) > 0`),
  ],
);
