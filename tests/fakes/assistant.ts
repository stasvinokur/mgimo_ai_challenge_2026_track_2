import {
  AskAssistant,
  type AssistantDependencies,
} from "@/application/assistant/ask-assistant";
import type {
  AssistantEvent,
  AssistantJournal,
  AssistantJournalRecord,
  AssistantRuntime,
  RuntimeInput,
} from "@/application/assistant/ports";
import { SubmitApprovedDraft } from "@/application/assistant/submit-approved";
import {
  GetCourseGrades,
  GetMyGrades,
} from "@/application/grades/get-my-grades";
import type { Clock } from "@/application/ports/clock";
import {
  type GetRegulation,
  SearchRegulations,
} from "@/application/regulations/use-cases";
import {
  CreateRequestDraft,
  UpdateRequestDraft,
} from "@/application/requests/drafts";
import {
  CheckRequestPayload,
  GetMyRequest,
  GetRequestCatalog,
} from "@/application/requests/queries";
import { GetToday, GetWeek } from "@/application/schedule/get-schedule";
import { AiSdkAssistantRuntime } from "@/infrastructure/ai/ai-sdk-runtime";
import { MemoryAssistantConversations } from "@/infrastructure/ai/conversations";
import { assistantMockModel } from "@/infrastructure/ai/mock-model";
import { FakeClock } from "./clock";
import { FakeGradesRepository } from "./grades";
import { SequentialIdGenerator } from "./id-generator";
import { anna, FakeRateLimiter, FakeTokens } from "./identity";
import { FakeRegulations } from "./regulations";
import { enrollmentType, FakeRequests } from "./requests";
import { FakeScheduleRepository, scheduleData } from "./schedule";

export const threadId = "00000000-0000-7000-8000-000000000099";
export class FakeAssistantJournal implements AssistantJournal {
  constructor(
    private readonly clock: Clock = new FakeClock("2026-11-04T09:00:00Z"),
  ) {}
  entries: Parameters<AssistantJournal["append"]>[0][] = [];
  records: (AssistantJournalRecord & {
    userId: string;
    sessionId?: string | null;
  })[] = [];
  demoUsers = new Set<string>();
  sessions = new Map<string, { userId: string; sessionId: string }>();
  reads: { userId: string; since: Date; limit: number; sessionId?: string }[] =
    [];
  async scopeForUser(userId: string, sessionTokenHash: string | null) {
    const session = sessionTokenHash
      ? this.sessions.get(sessionTokenHash)
      : null;
    return {
      demoAccount: this.demoUsers.has(userId),
      sessionId: session?.userId === userId ? session.sessionId : null,
    };
  }
  async listForUser(
    userId: string,
    since: Date,
    limit: number,
    sessionId?: string,
  ) {
    this.reads.push({
      userId,
      since,
      limit,
      ...(sessionId ? { sessionId } : {}),
    });
    return this.records
      .filter(
        (record) =>
          record.userId === userId &&
          new Date(record.at) >= since &&
          (!sessionId || record.sessionId === sessionId),
      )
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit)
      .map(({ userId: _owner, sessionId: _session, ...record }) =>
        structuredClone(record),
      );
  }
  async append(entry: Parameters<AssistantJournal["append"]>[0]) {
    this.entries.push(structuredClone(entry));
    this.records.push({
      userId: entry.userId,
      sessionId: (
        await this.scopeForUser(entry.userId, entry.sessionTokenHash ?? null)
      ).sessionId,
      at: this.clock.now().toISOString(),
      question: entry.question,
      sources: structuredClone(entry.sources),
      outcome: entry.outcome,
    });
  }
}
export function assistantFixture(runtime?: AssistantRuntime) {
  const clock = new FakeClock("2026-11-04T09:00:00Z");
  const ids = new SequentialIdGenerator();
  const db = new FakeRequests();
  db.types.push({
    ...enrollmentType,
    code: "question",
    title: "Вопрос в деканат",
    fieldsSchema: {
      type: "object",
      additionalProperties: false,
      required: ["question"],
      properties: {
        question: { type: "string", title: "Ваш вопрос", maxLength: 2000 },
      },
    },
  });
  const scheduleDb = new FakeScheduleRepository();
  scheduleDb.records.set("anna-student", scheduleData());
  const gradesDb = new FakeGradesRepository(
    new Map([
      [
        "anna-student",
        {
          targetScore: 86,
          scholarship: "increased",
          courses: [
            {
              id: "00000000-0000-7000-8000-000000000010",
              title: "Иностранный язык",
              exams: [],
              works: [
                {
                  id: "00000000-0000-7000-8000-000000000011",
                  title: "Работа 1",
                  weight: 45,
                  score: 77,
                  maxScore: 100,
                  dueAt: "2026-11-03T00:00:00Z",
                  isRequired: true,
                },
                {
                  id: "00000000-0000-7000-8000-000000000012",
                  title: "Работа 2",
                  weight: 45,
                  score: 99,
                  maxScore: 100,
                  dueAt: "2026-11-03T00:00:00Z",
                  isRequired: true,
                },
                {
                  id: "00000000-0000-7000-8000-000000000013",
                  title: "Контрольная",
                  weight: 10,
                  score: null,
                  maxScore: 100,
                  dueAt: "2026-11-10T00:00:00Z",
                  isRequired: true,
                },
              ],
            },
          ],
        },
      ],
    ]),
  );
  const regulationDb = new FakeRegulations();
  const regulations = {
    search: new SearchRegulations(regulationDb),
    get: {
      execute: async () => ({
        slug: "certificates",
        title: "Справки и заявления",
        introduction: "Вымышленное положение",
        sections: ["3.2", "4"].map((section) => ({
          section,
          title: "Сроки",
          body: "Срок — 3 рабочих дня.",
          anchor: `p-${section.replaceAll(".", "-")}`,
          href: `/regulations/certificates#p-${section.replaceAll(".", "-")}`,
        })),
      }),
    } satisfies Pick<GetRegulation, "execute">,
  };
  const journal = new FakeAssistantJournal(clock);
  const deps: AssistantDependencies = {
    clock,
    ids,
    journal,
    conversations: new MemoryAssistantConversations(clock),
    limiter: new FakeRateLimiter(clock),
    tokens: new FakeTokens(),
    runtime:
      runtime ??
      new AiSdkAssistantRuntime((input) => ({
        primary: assistantMockModel(input),
      })),
    logger: { info() {}, warn() {}, error() {} },
    schedule: {
      getToday: new GetToday(scheduleDb, clock),
      getWeek: new GetWeek(scheduleDb, clock),
    },
    grades: {
      getMyGrades: new GetMyGrades(gradesDb, clock),
      getCourseGrades: new GetCourseGrades(gradesDb, clock),
    },
    requests: {
      getCatalog: new GetRequestCatalog(db),
      getMyRequest: new GetMyRequest(db, clock),
      createDraft: new CreateRequestDraft(db, clock, ids),
      updateDraft: new UpdateRequestDraft(db, clock),
      checkPayload: new CheckRequestPayload(db, clock),
    },
    regulations,
    submit: new SubmitApprovedDraft(db, clock, ids),
  };
  const ask = new AskAssistant(deps);
  return {
    ask,
    deps,
    clock,
    ids,
    db,
    journal,
    gradesDb,
    regulationDb,
    actor: anna,
  };
}
export async function collect(events: AsyncIterable<AssistantEvent>) {
  const result: AssistantEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}
export function toolRuntime(
  run: (input: RuntimeInput) => Promise<unknown>,
): AssistantRuntime {
  return {
    async *stream(input) {
      await run(input);
      yield { type: "progress" };
    },
  };
}
