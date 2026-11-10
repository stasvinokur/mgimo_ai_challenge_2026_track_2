import { sql } from "drizzle-orm";
import {
  customType,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sessions, users } from "./identity";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
export const regulationChunks = pgTable(
  "regulation_chunks",
  {
    id: uuid().primaryKey(),
    seedKey: text("seed_key").unique(),
    docSlug: text("doc_slug").notNull(),
    section: text().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    tsv: tsvector().generatedAlwaysAs(
      sql`to_tsvector('russian'::regconfig, title || ' ' || body)`,
    ),
  },
  (t) => [
    index("regulation_chunks_tsv_idx").using("gin", t.tsv),
    unique("regulation_chunks_doc_section_unique").on(t.docSlug, t.section),
  ],
);
export const assistantLog = pgTable(
  "assistant_log",
  {
    id: uuid().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    sessionId: uuid("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    question: text().notNull(),
    sources: jsonb().$type<unknown[]>().notNull(),
    toolCalls: jsonb("tool_calls").$type<unknown[]>().notNull(),
    outcome: text().notNull(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("assistant_log_user_at_idx").on(t.userId, t.at),
    index("assistant_log_session_user_at_idx").on(t.sessionId, t.userId, t.at),
  ],
);
