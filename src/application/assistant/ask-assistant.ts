import { asksForOtherStudent, groundedFields } from "@/domain/assistant/safety";
import { EVENT_RELEASE_TYPE } from "@/domain/requests/event-release";
import { addWorkDays } from "@/domain/requests/sla-policy";
import { calculateWhatIf } from "../grades/calculation";
import type { GetCourseGrades, GetMyGrades } from "../grades/get-my-grades";
import type { SessionTokens } from "../identity/ports";
import type { Actor } from "../ports/actor";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { Logger } from "../ports/logger";
import type { RateLimiter } from "../ports/rate-limiter";
import type {
  GetRegulation,
  SearchRegulations,
} from "../regulations/use-cases";
import type {
  CreateRequestDraft,
  UpdateRequestDraft,
} from "../requests/drafts";
import type { RequestTypeDto } from "../requests/dto";
import type { PreviewEventRelease } from "../requests/event-release";
import type {
  CheckRequestPayload,
  GetMyRequest,
  GetRequestCatalog,
} from "../requests/queries";
import type { GetToday, GetWeek } from "../schedule/get-schedule";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from "../shared/errors";
import {
  asksAboutEvent,
  hasEventReleaseIntent,
  isEventQuestion,
  resolveEventDates,
} from "./event-fields";
import type {
  ApprovedSubmission,
  AssistantCodedMessage,
  AssistantConversations,
  AssistantEvent,
  AssistantJournal,
  AssistantMessageCode,
  AssistantOutcome,
  AssistantRuntime,
  AssistantSource,
  AssistantTools,
  DraftCard,
  ToolName,
} from "./ports";
import { formatMoscowDateTime, withLessonTiming } from "./schedule-context";
import {
  createToolSchemas,
  parseAssistantInput,
  parseToolInput,
  submitRequestToolSchema,
} from "./schemas";

export interface AssistantDependencies {
  schedule: {
    getToday: Pick<GetToday, "execute">;
    getWeek: Pick<GetWeek, "execute">;
  };
  grades: {
    getMyGrades: Pick<GetMyGrades, "execute">;
    getCourseGrades: Pick<GetCourseGrades, "execute">;
  };
  requests: {
    getCatalog: Pick<GetRequestCatalog, "execute">;
    getMyRequest: Pick<GetMyRequest, "execute">;
    createDraft: Pick<CreateRequestDraft, "execute">;
    updateDraft: Pick<UpdateRequestDraft, "execute">;
    checkPayload: Pick<CheckRequestPayload, "execute">;
    previewEvent?: Pick<PreviewEventRelease, "execute">;
  };
  regulations: {
    search: Pick<SearchRegulations, "execute">;
    get: Pick<GetRegulation, "execute">;
  };
  submit: ApprovedSubmission;
  runtime: AssistantRuntime;
  conversations: AssistantConversations;
  journal: AssistantJournal;
  limiter: RateLimiter;
  tokens: Pick<SessionTokens, "hash">;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
}

export class AskAssistant {
  constructor(private readonly deps: AssistantDependencies) {}
  async execute(
    actor: Actor,
    raw: unknown,
    client: { ip: string } = { ip: "unknown" },
    sessionToken?: string,
  ): Promise<AsyncIterable<AssistantEvent>> {
    if (actor.kind !== "student") throw new ForbiddenError();
    const input = parseAssistantInput(raw);
    const d = this.deps;
    const sessionTokenHash = sessionToken ? d.tokens.hash(sessionToken) : null;
    const question =
      input.action === "ask"
        ? input.question
        : input.approved
          ? "confirm_submission"
          : "decline_submission";
    const reservation = await d.limiter.reserve([
      {
        key: `assistant:${input.action}:pair:${d.tokens.hash(`${actor.userId}\0${client.ip}`)}`,
        limit: input.action === "ask" ? 20 : 60,
        windowSec: 600,
      },
      {
        key: `assistant:${input.action}:user:${d.tokens.hash(actor.userId)}`,
        limit: input.action === "ask" ? 600 : 1800,
        windowSec: 600,
      },
    ]);
    // Rejected attempts must not turn the rate limiter into unbounded journal writes.
    if (!reservation) throw new RateLimitedError();
    let lease: ReturnType<AssistantConversations["acquire"]>;
    try {
      lease = d.conversations.acquire(
        actor.userId,
        input.threadId,
        input.action === "ask",
      );
    } catch (error) {
      await reservation.release();
      throw error;
    }
    await reservation.commitFailure();
    const { state } = lease;
    if (
      input.action === "approve" &&
      (!state.pending || state.pending.id !== input.approvalId)
    ) {
      lease.release();
      await d.journal.append({
        userId: actor.userId,
        ...(sessionTokenHash ? { sessionTokenHash } : {}),
        question,
        tools: [],
        sources: [],
        outcome: "failed",
      });
      throw new NotFoundError();
    }
    const run = async function* (): AsyncGenerator<AssistantEvent> {
      const used: ToolName[] = [];
      const sources = new Map<string, AssistantSource>();
      const events: AssistantEvent[] = [];
      let outcome: AssistantOutcome = "answered";
      let fallback = false;
      let answer = "";
      const approved = input.action === "approve" && input.approved;
      const submitRequestTool = async (rawInput: unknown) => {
        const { draftId } = parseToolInput(submitRequestToolSchema, rawInput);
        const pending = state.pending;
        if (!approved || !pending || pending.draftId !== draftId)
          throw new ForbiddenError();
        delete state.pending;
        used.push("submit_request");
        return d.submit.execute(actor, pending, client.ip);
      };
      const text = (value: string): AssistantEvent => {
        answer += value;
        return { type: "text", text: value };
      };
      const message = (
        code: AssistantMessageCode,
        params: Record<string, string | number> = {},
      ): AssistantCodedMessage => {
        answer += JSON.stringify({ code, params });
        return { type: "message", code, params };
      };
      const addSource = (source: AssistantSource) => {
        if (!sources.has(source.href)) {
          sources.set(source.href, source);
          events.push({ type: "source", source });
        }
      };
      try {
        if (input.action === "ask" && asksForOtherStudent(question)) {
          outcome = "refused";
          yield message("refused");
          return;
        }
        if (input.action === "approve") {
          const pending = state.pending;
          if (!pending) throw new NotFoundError();
          if (!approved) {
            delete state.pending;
            outcome = "declined";
            yield {
              type: "declined",
              id: pending.draftId,
              approvalId: pending.id,
            };
            yield message("submissionDeclined");
            return;
          }
          const result = await submitRequestTool({ draftId: pending.draftId });
          outcome = "submitted";
          yield { type: "submitted", id: result.id, publicNo: result.publicNo };
          yield message("submittedMessage", { number: result.publicNo ?? "" });
          return;
        }
        const [catalog, today, grades] = await Promise.all([
          d.requests.getCatalog.execute(actor),
          d.schedule.getToday.execute(actor).catch(() => null),
          d.grades.getMyGrades.execute(actor).catch(() => null),
        ]);
        const now = today?.now ?? d.clock.now().toISOString();
        const nowMoscow = formatMoscowDateTime(now);
        const schedule = today
          ? {
              date: today.date,
              current: today.current
                ? withLessonTiming(today.current, now)
                : null,
              next: today.next ? withLessonTiming(today.next, now) : null,
              changes: today.changes.map((lesson) =>
                withLessonTiming(lesson, now),
              ),
            }
          : null;
        const schemas = createToolSchemas(catalog.types);
        const userHistory = state.history
          .filter((turn) => turn.role === "user")
          .map((turn) => turn.text);
        const words = [...userHistory, question].join("\n");
        const eventDates = resolveEventDates(question, userHistory);
        const addAttendanceSource = async () => {
          const doc = await d.regulations.get.execute(actor, {
            slug: "attendance",
          });
          const section = doc.sections.find(
            (section) => section.section === "4",
          );
          if (!section) throw new NotFoundError();
          const source = {
            href: section.href,
            documentTitle: doc.title,
            section: section.section,
            excerpt: section.body.slice(0, 600),
          };
          addSource(source);
        };
        if (isEventQuestion(question, words) && !eventDates) {
          await addAttendanceSource();
          while (events.length) {
            const event = events.shift();
            if (event) yield event;
          }
          yield message("clarifyEventDates");
          return;
        }
        let drafted: DraftCard | undefined;
        let noRegulations = false;
        const makeDraft = async (
          type: RequestTypeDto,
          payload: Record<string, string>,
          draftId?: string,
        ) => {
          const previous = draftId ?? drafted?.id ?? state.draftId;
          if (previous && previous !== state.draftId) throw new NotFoundError();
          const current = previous
            ? await d.requests.getMyRequest
                .execute(actor, { id: previous })
                .catch((error) => {
                  if (error instanceof NotFoundError && !draftId) return null;
                  throw error;
                })
            : null;
          let saved: { id: string };
          if (current?.status === "draft" && current.type.code === type.code) {
            saved = await d.requests.updateDraft.execute(actor, {
              id: current.id,
              payload: { ...current.payload, ...payload },
            });
          } else {
            if (draftId) throw new ConflictError();
            saved = await d.requests.createDraft.execute(
              actor,
              { typeCode: type.code, payload },
              client.ip,
            );
          }
          state.draftId = saved.id;
          delete state.pending;
          const detail = await d.requests.getMyRequest.execute(actor, saved);
          const doc = await d.regulations.get.execute(actor, {
            slug:
              type.code === EVENT_RELEASE_TYPE ? "attendance" : "certificates",
          });
          const sectionNumber =
            (
              {
                enrollment: "3.2",
                military: "3.3",
                visa: "3.4",
                scholarship: "3.5",
              } as Record<string, string>
            )[type.code] ?? "4";
          const section = doc.sections.find(
            (section) => section.section === sectionNumber,
          );
          if (!section) throw new NotFoundError();
          const source: AssistantSource = {
            href: section.href,
            documentTitle: doc.title,
            section: section.section,
            excerpt: section.body.slice(0, 600),
          };
          addSource(source);
          const validation = await d.requests.checkPayload
            .execute(actor, { typeCode: type.code, payload: detail.payload })
            .then(
              () => true,
              (error) => {
                if (error instanceof ValidationError) return false;
                throw error;
              },
            );
          const lessons =
            type.code === EVENT_RELEASE_TYPE &&
            d.requests.previewEvent &&
            detail.payload.dateFrom &&
            detail.payload.dateTo
              ? await d.requests.previewEvent.execute(actor, {
                  dateFrom: detail.payload.dateFrom,
                  dateTo: detail.payload.dateTo,
                })
              : undefined;
          drafted = {
            id: detail.id,
            typeCode: type.code,
            title: type.title,
            fields: [
              ...type.fields.map((field) => ({
                name: field.name,
                title: field.title,
                required: field.required,
                format: field.format,
                value: String(detail.payload[field.name] ?? ""),
              })),
            ],
            ...(lessons
              ? {
                  lessons: lessons.map(({ course, startsAt, room }) => ({
                    course,
                    startsAt,
                    room,
                  })),
                }
              : {}),
            slaWorkDays: type.slaWorkDays,
            expectedAt: addWorkDays(
              d.clock.now(),
              type.slaWorkDays,
            ).toISOString(),
            delivery: type.delivery,
            href: `/requests/${detail.id}`,
            source,
            canSubmit: validation,
          };
          if (validation) {
            state.pending = {
              id: d.ids.next(),
              draftId: detail.id,
              updatedAt: detail.updatedAt,
              payload: detail.payload,
            };
            drafted.approvalId = state.pending.id;
          }
          outcome = "drafted";
          events.push({ type: "draft", draft: drafted });
          return drafted;
        };
        const tools: AssistantTools = {
          schemas,
          execute: async (name, rawInput) => {
            if (!used.includes(name)) used.push(name);
            switch (name) {
              case "find_schedule": {
                const data = parseToolInput(schemas.find_schedule, rawInput);
                if (data.view === "week") {
                  const week = await d.schedule.getWeek.execute(actor);
                  return {
                    ...week,
                    nowMoscow: formatMoscowDateTime(week.now),
                    days: week.days.map((day) => ({
                      ...day,
                      lessons: day.lessons.map((lesson) =>
                        withLessonTiming(lesson, week.now),
                      ),
                    })),
                  };
                }
                return {
                  nowMoscow,
                  next: schedule?.next ?? null,
                  current: schedule?.current ?? null,
                  ...(data.view === "changes"
                    ? { changes: schedule?.changes ?? [] }
                    : {}),
                  available: schedule !== null,
                };
              }
              case "explain_grade": {
                const data = parseToolInput(schemas.explain_grade, rawInput);
                return data.courseId
                  ? d.grades.getCourseGrades.execute(actor, data)
                  : grades;
              }
              case "what_if": {
                const data = parseToolInput(schemas.what_if, rawInput);
                const detail = await d.grades.getCourseGrades.execute(actor, {
                  courseId: data.courseId,
                });
                return calculateWhatIf(
                  detail.course.works,
                  Object.fromEntries(
                    data.predictions.map((p) => [p.assessmentId, p.score]),
                  ),
                  detail.targetScore,
                );
              }
              case "search_regulations": {
                const data = parseToolInput(
                  schemas.search_regulations,
                  rawInput,
                );
                const found = await d.regulations.search.execute(actor, data);
                found.forEach(addSource);
                noRegulations = found.length === 0;
                return found;
              }
              case "draft_request": {
                const data = parseToolInput(schemas.draft_request, rawInput);
                const type = catalog.types.find(
                  (type) => type.code === data.type,
                );
                if (!type) throw new NotFoundError();
                const payload = groundedFields(data.fields, words);
                if (type.code === EVENT_RELEASE_TYPE) {
                  if (!eventDates)
                    throw new ValidationError({
                      dates: ["Уточните точные даты и год мероприятия."],
                    });
                  Object.assign(payload, eventDates);
                }
                if (
                  Object.keys(data.fields).some(
                    (key) => !type.fields.some((field) => field.name === key),
                  )
                )
                  throw new ValidationError({
                    fields: ["Поле не относится к выбранной заявке."],
                  });
                // An employer is an explicit destination, even when no organisation was named.
                if (
                  type.code === "enrollment" &&
                  !payload.destination &&
                  /работодател/iu.test(question)
                )
                  payload.destination =
                    question.match(/работодател[\p{L}]*/iu)?.[0] ?? "";
                return makeDraft(type, payload, data.draftId);
              }
              case "submit_request":
                return submitRequestTool(rawInput);
            }
          },
        };
        const currentDraft = state.draftId
          ? await d.requests.getMyRequest
              .execute(actor, { id: state.draftId })
              .catch((error) => {
                if (error instanceof NotFoundError) return null;
                throw error;
              })
          : null;
        const context = JSON.stringify({
          now,
          nowMoscow,
          schedule,
          grades: grades
            ? {
                summary: grades.summary,
                courses: grades.courses.map((course) => ({
                  id: course.id,
                  title: course.title,
                  currentScore: course.currentScore,
                  pending: course.works
                    .filter((work) => work.score === null)
                    .map((work) => ({
                      id: work.id,
                      title: work.title,
                      maxScore: work.maxScore,
                    })),
                })),
              }
            : null,
          requestTypes: catalog.types.map((type) => ({
            code: type.code,
            title: type.title,
            fields: type.fields,
          })),
          draftId: currentDraft?.id,
          draft: currentDraft
            ? {
                id: currentDraft.id,
                type: currentDraft.type.code,
                title: currentDraft.type.title,
                status: currentDraft.status,
                fields: Object.fromEntries(
                  currentDraft.type.fields.flatMap((field) => {
                    const value = currentDraft.payload[field.name];
                    return typeof value === "string" && value.trim()
                      ? [[field.name, value]]
                      : [];
                  }),
                ),
              }
            : null,
        });
        try {
          for await (const event of d.runtime.stream({
            question,
            history: state.history,
            context,
            tools,
          })) {
            while (events.length) {
              const queued = events.shift();
              if (queued) yield queued;
            }
            if (event.type === "text") yield text(event.text);
          }
        } catch {
          fallback = true;
          outcome = "fallback";
          d.logger.warn("assistant_fallback", {
            user_id: actor.userId,
            code: "LLM_UNAVAILABLE",
          });
          yield { type: "mode", mode: "fallback" };
          yield message(answer ? "interrupted" : "fallbackStart");
          if (isEventQuestion(question, words)) {
            await addAttendanceSource();
            noRegulations = false;
            const previousQuestion = state.history
              .filter((turn) => turn.role === "user")
              .at(-1)?.text;
            const wantsRelease =
              hasEventReleaseIntent(question) ||
              (!asksAboutEvent(question) &&
                previousQuestion !== undefined &&
                asksAboutEvent(previousQuestion) &&
                hasEventReleaseIntent(previousQuestion));
            if (wantsRelease) {
              if (!drafted)
                await tools.execute("draft_request", {
                  type: EVENT_RELEASE_TYPE,
                  fields: {},
                });
              yield message("eventDraftSaved");
            } else {
              yield message("eventInformation");
            }
          } else if (
            /следующ|где.*пар/iu.test(question) ||
            /\bnext\s+(?:class|lesson|lecture)\b/iu.test(question)
          ) {
            used.push("find_schedule");
            const lesson = schedule?.next;
            if (!today) yield message("scheduleUnavailable");
            else if (lesson)
              yield message("nextLesson", {
                course: lesson.course,
                room: lesson.room,
                startsAt: lesson.startsAt,
                endsAt: lesson.endsAt,
                status: lesson.status,
                now,
              });
            else yield message("noNextLesson");
          } else if (
            /измен/iu.test(question) ||
            /\bwhat(?:\s+has|['’]s)?\s+changed\b/iu.test(question) ||
            /\b(?:changes|updates)\b.*\b(?:schedule|timetable)\b|\b(?:schedule|timetable)\b.*\b(?:changed|changes|updates)\b/iu.test(
              question,
            )
          ) {
            used.push("find_schedule");
            if (!today) yield message("scheduleUnavailable");
            else if (schedule?.changes.length) {
              for (const lesson of schedule.changes)
                yield message("changedLesson", {
                  course: lesson.course,
                  room: lesson.room,
                  startsAt: lesson.startsAt,
                  endsAt: lesson.endsAt,
                  status: lesson.status,
                  now,
                });
            } else yield message("noChanges");
          } else if (
            /долг/iu.test(question) ||
            /\b(?:academic\s+)?debts?\b|\boverdue\s+(?:work|assignments?)\b/iu.test(
              question,
            )
          ) {
            used.push("explain_grade");
            yield grades
              ? message("debts", {
                  count: grades.summary.openDebts,
                  courses: grades.courses
                    .filter((course) => course.openDebts > 0)
                    .map((course) => course.title)
                    .join(", "),
                })
              : message("gradesUnavailable");
          } else if (
            /работодател/iu.test(question) ||
            /\bemployer\b/iu.test(question)
          ) {
            const employer = /работодател/iu.test(question)
              ? undefined
              : question.match(/\bemployer\b/iu)?.[0];
            const type = catalog.types.find(
              (type) => type.code === "enrollment",
            );
            if (type && !drafted)
              await tools.execute("draft_request", {
                type: type.code,
                fields: employer ? { destination: employer } : {},
              });
            yield message("draftSaved");
          } else {
            const found = (await tools.execute("search_regulations", {
              query: question.slice(0, 200),
            })) as AssistantSource[];
            yield text(
              found
                .map((source) =>
                  source.excerpt.replaceAll("[[[", "").replaceAll("]]]", ""),
                )
                .join("\n\n"),
            );
          }
        }
        if (noRegulations) {
          if (
            !/не\s+знаю[.!…]?\s*передать\s+вопрос\s+в\s+деканат\?/iu.test(
              answer.replace(/[*_`]/g, ""),
            )
          ) {
            yield message("unknownAnswer");
          }
          const type = catalog.types.find((type) => type.code === "question");
          if (type && !drafted) await makeDraft(type, { question });
        }
        while (events.length) {
          const queued = events.shift();
          if (queued) yield queued;
        }
        if (!answer && !drafted) yield message("noAnswer");
      } catch (error) {
        outcome = "failed";
        throw error;
      } finally {
        state.history = [
          ...state.history,
          { role: "user", text: question },
          { role: "assistant", text: answer.slice(0, 4000) },
        ].slice(-12) as typeof state.history;
        lease.release();
        await d.journal.append({
          userId: actor.userId,
          ...(sessionTokenHash ? { sessionTokenHash } : {}),
          question,
          tools: [...new Set(used)],
          sources: [...sources.keys()],
          outcome: fallback && outcome !== "failed" ? "fallback" : outcome,
        });
      }
    };
    return run();
  }
}
