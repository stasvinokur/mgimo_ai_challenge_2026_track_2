import { sectionAnchor } from "@/domain/regulations/markdown";
import {
  addDays,
  isoWeek,
  moscowDate,
  weekStart,
} from "@/domain/schedule/dates";
import { buildSchedule } from "@/domain/schedule/schedule";
import { normalizeSearchText, searchExcerpt } from "@/domain/search/text";
import type { GradesRepository } from "../grades/ports";
import type { Actor } from "../ports/actor";
import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";
import type { RegulationSearch } from "../regulations/ports";
import type { RequestRepository } from "../requests/ports";
import type { ScheduleRepository } from "../schedule/ports";
import { ForbiddenError } from "../shared/errors";
import type { SearchDto, SearchGroupDto, SearchResultDto } from "./dto";
import { isInternalSearchHref } from "./links";
import { parseSearchInput } from "./schemas";

export const SEARCH_GROUP_LIMIT = 3;

export class SearchCabinet {
  constructor(
    private readonly schedule: Pick<ScheduleRepository, "findForStudent">,
    private readonly grades: Pick<GradesRepository, "listForStudent">,
    private readonly requests: Pick<
      RequestRepository,
      "listForStudent" | "listTypes"
    >,
    private readonly regulations: Pick<RegulationSearch, "search">,
    private readonly clock: Pick<Clock, "now">,
    private readonly logger: Pick<Logger, "error">,
  ) {}

  async execute(actor: Actor, input: unknown): Promise<SearchDto> {
    if (actor.kind !== "student") throw new ForbiddenError();
    const { q } = parseSearchInput(input);
    const query = normalizeSearchText(q);
    const matches = (...texts: string[]) =>
      texts.some((text) => normalizeSearchText(text).includes(query));
    const start = weekStart(moscowDate(this.clock.now()));
    const [schedule, grades, requests, types, regulations] = await Promise.all([
      this.read("SEARCH_SCHEDULE_UNAVAILABLE", () =>
        this.schedule.findForStudent(actor.studentId),
      ),
      this.read("SEARCH_GRADES_UNAVAILABLE", () =>
        this.grades.listForStudent(actor.studentId),
      ),
      this.read("SEARCH_REQUESTS_UNAVAILABLE", () =>
        this.requests.listForStudent(actor.studentId),
      ),
      this.read("SEARCH_CATALOG_UNAVAILABLE", () => this.requests.listTypes()),
      this.read("SEARCH_REGULATIONS_UNAVAILABLE", () =>
        this.regulations.search(query),
      ),
    ]);
    const scheduleItems: SearchResultDto[] =
      schedule.ok && schedule.data
        ? buildSchedule(schedule.data, start, addDays(start, 6))
            .filter((lesson) =>
              matches(lesson.course, lesson.teacher, lesson.room),
            )
            .map((lesson) => ({
              id: `${lesson.id}:${lesson.status}`,
              title: lesson.course,
              context: {
                code: "schedule",
                startsAt: lesson.startsAt,
                teacher: lesson.teacher,
                room: lesson.room,
                status: lesson.status,
              },
              href: `/schedule?view=week&week=${isoWeek(lesson.date)}`,
            }))
        : [];
    const gradeItems: SearchResultDto[] = [];
    if (grades.ok && grades.data) {
      for (const course of grades.data.courses) {
        const href = `/grades/${encodeURIComponent(course.id)}`;
        if (matches(course.title))
          gradeItems.push({
            id: course.id,
            title: course.title,
            context: { code: "course" },
            href,
          });
        for (const work of course.works) {
          if (matches(work.title))
            gradeItems.push({
              id: work.id,
              title: work.title,
              context: {
                code: "work",
                course: course.title,
                score: work.score,
                maxScore: work.maxScore,
                dueAt: work.dueAt,
              },
              href,
            });
        }
      }
    }
    const typeNames = new Map(
      types.ok ? types.data.map((type) => [type.code, type.title]) : [],
    );
    const requestItems: SearchResultDto[] = requests.ok
      ? requests.data
          .filter((request) =>
            matches(
              request.status === "draft" ? "" : request.publicNo,
              typeNames.get(request.typeCode) ?? request.typeCode,
            ),
          )
          .map((request) => ({
            id: request.id,
            title: {
              code: "request",
              publicNo: request.status === "draft" ? null : request.publicNo,
              typeTitle: typeNames.get(request.typeCode) ?? null,
            },
            context: { code: "request", status: request.status },
            href: `/requests/${encodeURIComponent(request.id)}`,
          }))
      : [];
    if (types.ok) {
      for (const type of types.data) {
        if (matches(type.title, type.description))
          requestItems.push({
            id: `type:${type.code}`,
            title: type.title,
            context: {
              code: "requestType",
              description: searchExcerpt(type.description, query),
            },
            href: `/requests/new?type=${encodeURIComponent(type.code)}`,
          });
      }
    }
    const regulationItems: SearchResultDto[] = regulations.ok
      ? regulations.data.map((match) => ({
          id: `${match.slug}:${match.section}`,
          title: match.title,
          context: {
            code: "regulation",
            documentTitle: match.documentTitle,
            section: match.section,
            excerpt: match.excerpt,
          },
          markedContext: true,
          href: `/regulations/${encodeURIComponent(match.slug)}#${sectionAnchor(match.section)}`,
        }))
      : [];
    return {
      query: q,
      groups: [
        group("schedule", schedule.ok ? "ok" : "error", scheduleItems),
        group("grades", grades.ok ? "ok" : "error", gradeItems),
        group(
          "requests",
          requests.ok && types.ok
            ? "ok"
            : requests.ok || types.ok
              ? "partial"
              : "error",
          requestItems,
        ),
        group("regulations", regulations.ok ? "ok" : "error", regulationItems),
      ],
    };
  }

  private async read<T>(
    code: string,
    load: () => Promise<T>,
  ): Promise<{ ok: true; data: T } | { ok: false }> {
    try {
      return { ok: true, data: await load() };
    } catch {
      this.logger.error("search_source_unavailable", { code });
      return { ok: false };
    }
  }
}

function group(
  id: SearchGroupDto["id"],
  status: SearchGroupDto["status"],
  items: SearchResultDto[],
): SearchGroupDto {
  if (items.some((item) => !isInternalSearchHref(item.href)))
    throw new Error("SEARCH_INVALID_HREF");
  return {
    id,
    status,
    items: items.slice(0, SEARCH_GROUP_LIMIT),
    more: Math.max(0, items.length - SEARCH_GROUP_LIMIT),
  };
}
