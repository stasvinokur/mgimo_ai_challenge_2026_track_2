import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { requests } from "./requests";

export const certificates = pgTable(
  "certificates",
  {
    id: uuid().primaryKey(),
    seedKey: text("seed_key").unique(),
    requestId: uuid("request_id")
      .notNull()
      .unique()
      .references(() => requests.id),
    number: text().notNull().unique(),
    verifyCode: text("verify_code").notNull().unique(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("certificates_issued_idx").on(t.issuedAt)],
);
