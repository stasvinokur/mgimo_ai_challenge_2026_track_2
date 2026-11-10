import type { Actor } from "../ports/actor";
import type { RegulationResultDto } from "../regulations/use-cases";
import type { RequestDto } from "../requests/dto";
import type { createToolSchemas } from "./schemas";

export type ToolName =
  | "find_schedule"
  | "explain_grade"
  | "what_if"
  | "search_regulations"
  | "draft_request"
  | "submit_request";
export type AssistantOutcome =
  | "answered"
  | "drafted"
  | "submitted"
  | "declined"
  | "failed"
  | "refused"
  | "fallback";
export type AssistantSource = Pick<
  RegulationResultDto,
  "href" | "documentTitle" | "section" | "excerpt"
>;
export interface DraftCard {
  id: string;
  typeCode?: string;
  title: string;
  fields: {
    name?: string;
    title: string;
    value: string;
    format?: string;
    required: boolean;
  }[];
  lessons?: { course: string; startsAt: string; room: string }[];
  slaWorkDays: number;
  expectedAt: string;
  delivery: "pdf" | "pickup";
  href: string;
  source: AssistantSource;
  canSubmit: boolean;
  approvalId?: string;
}
export type AssistantMessageCode =
  | "refused"
  | "submissionDeclined"
  | "submittedMessage"
  | "clarifyEventDates"
  | "fallbackStart"
  | "interrupted"
  | "eventDraftSaved"
  | "eventInformation"
  | "scheduleUnavailable"
  | "noNextLesson"
  | "nextLesson"
  | "changedLesson"
  | "noChanges"
  | "debts"
  | "gradesUnavailable"
  | "draftSaved"
  | "unknownAnswer"
  | "noAnswer";
export type AssistantCodedMessage = {
  type: "message";
  code: AssistantMessageCode;
  params: Record<string, string | number>;
};
export type AssistantEvent =
  | { type: "text"; text: string }
  | AssistantCodedMessage
  | { type: "source"; source: AssistantSource }
  | { type: "draft"; draft: DraftCard }
  | { type: "mode"; mode: "fallback" }
  | { type: "submitted"; id: string; publicNo: string | null }
  | { type: "declined"; id: string; approvalId: string };

export interface AssistantTools {
  execute(name: ToolName, input: unknown): Promise<unknown>;
  schemas: ReturnType<typeof createToolSchemas>;
}
export interface RuntimeInput {
  question: string;
  history: { role: "user" | "assistant"; text: string }[];
  context: string;
  tools: AssistantTools;
}
export type RuntimeEvent =
  | { type: "text"; text: string }
  | { type: "progress" };
export interface AssistantRuntime {
  stream(input: RuntimeInput): AsyncIterable<RuntimeEvent>;
}
export interface PendingApproval {
  id: string;
  draftId: string;
  updatedAt: string;
  payload: Record<string, unknown>;
}
export interface Conversation {
  history: RuntimeInput["history"];
  draftId?: string;
  pending?: PendingApproval;
}
export interface AssistantConversations {
  acquire(
    userId: string,
    threadId: string,
    create?: boolean,
  ): { state: Conversation; release(): void };
}
export interface AssistantJournal {
  scopeForUser(
    userId: string,
    sessionTokenHash: string | null,
    now: Date,
  ): Promise<{ demoAccount: boolean; sessionId: string | null }>;
  listForUser(
    userId: string,
    since: Date,
    limit: number,
    sessionId?: string,
  ): Promise<AssistantJournalRecord[]>;
  append(entry: {
    userId: string;
    sessionTokenHash?: string | null;
    question: string;
    tools: ToolName[];
    sources: string[];
    outcome: AssistantOutcome;
  }): Promise<void>;
}
export interface AssistantJournalRecord {
  at: string;
  question: string;
  sources: string[];
  outcome: string;
}
export interface ApprovedSubmission {
  execute(
    actor: Actor,
    approval: PendingApproval,
    ip?: string,
  ): Promise<RequestDto>;
}
