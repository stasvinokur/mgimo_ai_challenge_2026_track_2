import { sql } from "drizzle-orm";
import {
  check,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity";

export const onboardingSteps = pgTable(
  "onboarding_steps",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stepCode: text("step_code").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.stepCode] }),
    check("onboarding_step_code", sql`length(trim(${t.stepCode})) > 0`),
  ],
);
