import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";
import { requests } from "./requests";

export const staffAuditLog = pgTable(
  "staff_audit_log",
  {
    id: uuid().primaryKey(),
    staffUserId: uuid("staff_user_id")
      .notNull()
      .references(() => users.id),
    action: text().notNull(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("staff_audit_log_staff_at_idx").on(t.staffUserId, t.at),
    index("staff_audit_log_request_idx").on(t.requestId),
  ],
);
