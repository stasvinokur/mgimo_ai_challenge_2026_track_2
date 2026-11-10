import type { Sql } from "postgres";
import type {
  AssistantJournal,
  AssistantJournalRecord,
} from "@/application/assistant/ports";
import type { Clock } from "@/application/ports/clock";
import type { IdGenerator } from "@/application/ports/id-generator";
import { SESSION_ABSOLUTE_TTL_MS } from "@/domain/identity/session-policy";

export class PostgresAssistantJournal implements AssistantJournal {
  constructor(
    private readonly database: () => Sql,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}
  async scopeForUser(
    userId: string,
    sessionTokenHash: string | null,
    now: Date,
  ) {
    const [scope] = await this.database()<
      { demoAccount: boolean; sessionId: string | null }[]
    >`select u.seed_key is not null as "demoAccount", s.id as "sessionId"
      from users u left join sessions s on s.user_id = u.id
        and s.token_hash = ${sessionTokenHash}
        and s.expires_at > ${now.toISOString()}::timestamptz
        and s.created_at > ${new Date(now.getTime() - SESSION_ABSOLUTE_TTL_MS).toISOString()}::timestamptz
      where u.id = ${userId}`;
    return scope ?? { demoAccount: true, sessionId: null };
  }
  async listForUser(
    userId: string,
    since: Date,
    limit: number,
    sessionId?: string,
  ) {
    const rows = await this.database()<
      {
        at: Date;
        question: string;
        sources: unknown;
        outcome: string;
      }[]
    >`select at, question, sources, outcome from assistant_log
      where user_id = ${userId} and at >= ${since.toISOString()}::timestamptz
        and (${sessionId ?? null}::uuid is null or session_id = ${sessionId ?? null}::uuid)
      order by at desc, id desc limit ${limit}`;
    return rows.map(
      (row): AssistantJournalRecord => ({
        at: row.at.toISOString(),
        question: row.question,
        sources: Array.isArray(row.sources)
          ? row.sources.filter(
              (source): source is string => typeof source === "string",
            )
          : [],
        outcome: row.outcome,
      }),
    );
  }
  async append(entry: Parameters<AssistantJournal["append"]>[0]) {
    const now = this.clock.now();
    // Resolve and lock only during this statement: a stream may outlive its session.
    await this.database()`insert into assistant_log (id, user_id, session_id, question, tool_calls, sources, outcome, at)
      values (${this.ids.next()}, ${entry.userId}, (
        select id from sessions where user_id = ${entry.userId}
          and token_hash = ${entry.sessionTokenHash ?? null}
          and expires_at > ${now.toISOString()}::timestamptz
          and created_at > ${new Date(now.getTime() - SESSION_ABSOLUTE_TTL_MS).toISOString()}::timestamptz
        for key share
      ), ${entry.question}, ${JSON.stringify(entry.tools)}::text::jsonb, ${JSON.stringify(entry.sources)}::text::jsonb, ${entry.outcome}, ${now.toISOString()}::timestamptz)`;
  }
}
