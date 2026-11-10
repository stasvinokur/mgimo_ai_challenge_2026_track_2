import type { SessionTokens } from "../identity/ports";
import type { Actor } from "../ports/actor";
import type { Clock } from "../ports/clock";
import type { GetRegulation } from "../regulations/use-cases";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import type { AssistantJournal, AssistantJournalRecord } from "./ports";

export const assistantJournalLimit = 200;
export interface AssistantJournalEntryDto {
  at: string;
  question: string;
  questionLabel: "question" | "action";
  questionCode: "confirm" | "decline" | null;
  sources: { href: string; label: string }[];
  assistantAction:
    | "answered"
    | "drafted"
    | "submitted"
    | "declined"
    | "failed"
    | "refusedAction"
    | "fallbackMode"
    | "unknownOutcome";
  studentDecision: {
    code: "requestSubmitted" | "draftRetained" | "submissionFailed";
    href?: string;
  } | null;
}

export class GetMyAssistantJournal {
  constructor(
    private readonly journal: AssistantJournal,
    private readonly regulations: Pick<GetRegulation, "execute">,
    private readonly clock: Clock,
    private readonly tokens: Pick<SessionTokens, "hash">,
  ) {}

  async execute(
    actor: Actor,
    sessionToken?: string,
  ): Promise<AssistantJournalEntryDto[]> {
    if (actor.kind !== "student") throw new ForbiddenError();
    const now = this.clock.now();
    const scope = await this.journal.scopeForUser(
      actor.userId,
      sessionToken ? this.tokens.hash(sessionToken) : null,
      now,
    );
    if (scope.demoAccount && !scope.sessionId) return [];
    const since = new Date(now.getTime() - 14 * 86_400_000);
    const records = await this.journal.listForUser(
      actor.userId,
      since,
      assistantJournalLimit,
      scope.demoAccount ? (scope.sessionId ?? undefined) : undefined,
    );
    const sources = new Map<string, { href: string; label: string }>();
    const slugs = new Set(
      records.flatMap((record) =>
        record.sources.flatMap((href) => {
          const slug = /^\/regulations\/([a-z]+(?:-[a-z]+)*)#p-[\d-]+$/.exec(
            href,
          )?.[1];
          return slug && slug.length <= 80 ? [slug] : [];
        }),
      ),
    );
    for (const slug of slugs) {
      try {
        const document = await this.regulations.execute(actor, { slug });
        for (const section of document.sections) {
          sources.set(section.href, {
            href: section.href,
            label: `${document.title} · § ${section.section}`,
          });
        }
      } catch (error) {
        // A removed regulation must not become an unverified link.
        if (!(error instanceof NotFoundError)) throw error;
      }
    }
    return records.map((record) => ({
      at: record.at,
      question: record.question,
      questionCode: decisionCode(record),
      questionLabel: decisionCode(record) ? "action" : "question",
      sources: [...new Set(record.sources)].flatMap((href) => {
        const source = sources.get(href);
        return source ? [source] : [];
      }),
      ...describeOutcome(record),
    }));
  }
}

function describeOutcome(
  record: AssistantJournalRecord,
): Pick<AssistantJournalEntryDto, "assistantAction" | "studentDecision"> {
  const outcome = record.outcome;
  switch (outcome) {
    case "submitted":
      return {
        assistantAction: "submitted",
        studentDecision: { code: "requestSubmitted", href: "/requests" },
      };
    case "declined":
      return {
        assistantAction: "declined",
        studentDecision: { code: "draftRetained" },
      };
    case "failed":
      return {
        assistantAction: "failed",
        studentDecision:
          decisionCode(record) === "confirm"
            ? {
                code: "submissionFailed",
                href: "/requests",
              }
            : null,
      };
    default:
      return {
        assistantAction:
          outcome === "answered"
            ? "answered"
            : outcome === "drafted"
              ? "drafted"
              : outcome === "refused"
                ? "refusedAction"
                : outcome === "fallback"
                  ? "fallbackMode"
                  : "unknownOutcome",
        studentDecision: null,
      };
  }
}

function decisionCode(
  record: AssistantJournalRecord,
): AssistantJournalEntryDto["questionCode"] {
  if (record.outcome === "submitted") return "confirm";
  if (record.outcome === "declined") return "decline";
  if (record.outcome !== "failed") return null;
  if (record.question === "confirm_submission") return "confirm";
  if (record.question === "decline_submission") return "decline";
  // Existing journal records predate coded actions; retain their meaning at the storage boundary.
  if (record.outcome === "failed" && record.question === "Подтвердить отправку")
    return "confirm";
  return null;
}
