import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity";

export const notificationKind = pgEnum("notification_kind", [
  "change",
  "deadline",
  "request",
  "news",
  "alert",
]);
export const notificationPriority = pgEnum("notification_priority", [
  "high",
  "normal",
  "low",
]);
export const announcementAudience = pgEnum("announcement_audience", [
  "all",
  "faculty",
  "course",
  "group",
]);
export const notifications = pgTable(
  "notifications",
  {
    id: uuid().primaryKey(),
    seedKey: text("seed_key").unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kind: notificationKind().notNull(),
    priority: notificationPriority().notNull().default("normal"),
    title: text().notNull(),
    body: text().notNull(),
    link: text().notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    pushedAt: timestamp("pushed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
    index("notifications_user_read_idx").on(t.userId, t.readAt),
    index("notifications_push_pending_idx")
      .on(t.createdAt)
      .where(sql`${t.pushedAt} is null`),
  ],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text().notNull().unique(),
    p256dh: text().notNull(),
    auth: text().notNull(),
    failures: integer().notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("push_subscriptions_user_idx").on(t.userId),
    check(
      "push_endpoint_https",
      sql`${t.endpoint} ~ '^https://[^/[:space:]]+'`,
    ),
    check("push_failures_nonnegative", sql`${t.failures} >= 0`),
  ],
);
export const announcements = pgTable(
  "announcements",
  {
    id: uuid().primaryKey(),
    seedKey: text("seed_key").unique(),
    audience: announcementAudience().notNull(),
    audienceRef: text("audience_ref"),
    title: text().notNull(),
    body: text().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("announcements_audience_idx").on(
      t.audience,
      t.audienceRef,
      t.publishedAt,
    ),
    check(
      "announcements_audience_ref",
      sql`(${t.audience} = 'all' and ${t.audienceRef} is null) or (${t.audience} <> 'all' and ${t.audienceRef} is not null)`,
    ),
  ],
);
