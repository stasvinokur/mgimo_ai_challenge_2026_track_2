import {
  EVENT_RELEASE_TYPE,
  eventLessons,
} from "@/domain/requests/event-release";
import { moscowDate } from "@/domain/schedule/dates";
import type { Actor } from "../ports/actor";
import type { Clock } from "../ports/clock";
import type { EventReleaseReview } from "../requests/event-release";
import { parseRequestId, savedEventLessons } from "../requests/schemas";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import { staffQueueCardDto, staffRequestDto } from "./dto";
import type { StaffRequestRepository } from "./ports";
import { parseStaffFilters } from "./schemas";

export class ListStaffRequests {
  constructor(
    private readonly repo: StaffRequestRepository,
    private readonly clock: Clock,
  ) {}
  async execute(actor: Actor, input: unknown) {
    if (actor.kind !== "staff") throw new ForbiddenError();
    const filters = parseStaffFilters(input);
    const now = this.clock.now();
    const types = await this.repo.listTypes();
    const rows = await this.repo.listForFaculties(
      actor.facultyIds,
      new Date(now.getTime() - 7 * 86_400_000).toISOString(),
    );
    const requests = rows
      .filter(
        (row) =>
          filters.scope !== "mine" || row.assigneeStaffId === actor.staffId,
      )
      .map((row) => {
        const type = types.find((type) => type.code === row.request.typeCode);
        if (!type) throw new NotFoundError();
        return staffQueueCardDto(row, type, now);
      })
      .filter(
        (row) =>
          (!filters.type || row.type.code === filters.type) &&
          (filters.sla === "all" || row.sla === filters.sla) &&
          (!filters.q || row.publicNo?.startsWith(filters.q)),
      );
    const priority = { overdue: 0, soon: 1, on_time: 2 };
    requests.sort(
      (a, b) =>
        (a.sla ? priority[a.sla] : 3) - (b.sla ? priority[b.sla] : 3) ||
        (a.dueAt ?? "").localeCompare(b.dueAt ?? "") ||
        a.id.localeCompare(b.id),
    );
    return {
      demoCommentsOnly: await this.repo.isDemoUser(actor.userId),
      requests,
      types: types.map(({ code, title }) => ({ code, title })),
      filters,
    };
  }
}
export class GetStaffRequest {
  constructor(
    private readonly repo: StaffRequestRepository,
    private readonly clock: Clock,
  ) {}
  async execute(actor: Actor, input: { id: string }) {
    if (actor.kind !== "staff") throw new ForbiddenError();
    const id = parseRequestId(input.id);
    const row = await this.repo.findByIdForFaculties(id, actor.facultyIds);
    if (!row) throw new NotFoundError();
    const type = (await this.repo.listTypes()).find(
      (type) => type.code === row.request.typeCode,
    );
    if (!type) throw new NotFoundError();
    const now = this.clock.now();
    let eventReview: EventReleaseReview | undefined;
    if (type.code === EVENT_RELEASE_TYPE) {
      const context = await this.repo.findEventContextForFaculties(
        id,
        actor.facultyIds,
      );
      if (!context) throw new NotFoundError();
      const from = String(row.request.payload.dateFrom ?? "");
      const to = String(row.request.payload.dateTo ?? "");
      const lessons = eventLessons(context.schedule, from, to);
      const snapshot = savedEventLessons({
        eventLessons:
          row.request.payload.submittedEventLessons ??
          row.request.payload.eventLessons,
      });
      const signature = (list: typeof lessons) =>
        JSON.stringify(
          list.map((lesson) => [
            lesson.slotId,
            lesson.occurrenceDate,
            lesson.date,
            lesson.course,
            lesson.startsAt,
            lesson.endsAt,
            lesson.room,
          ]),
        );
      const records = new Map(
        context.records.map((record) => [
          `${record.slotId}:${record.occurrenceDate}`,
          record.status,
        ]),
      );
      eventReview = {
        past: from < moscowDate(now),
        changed: signature(lessons) !== signature(snapshot),
        lessons: lessons.map((lesson) => ({
          ...lesson,
          attendanceStatus:
            records.get(`${lesson.slotId}:${lesson.occurrenceDate}`) ?? null,
        })),
      };
    }
    return {
      ...staffRequestDto(row, type, now),
      demoCommentsOnly: await this.repo.isDemoUser(actor.userId),
      ...(eventReview ? { eventReview } : {}),
      events: (
        await this.repo.listEventsForFaculties(id, actor.facultyIds)
      ).map(({ actorUserId: _actor, requestId: _request, ...event }) => event),
      audit: await this.repo.listAuditForFaculties(id, actor.facultyIds),
    };
  }
}
export type StaffQueueDto = Awaited<ReturnType<ListStaffRequests["execute"]>>;
export type StaffDetailDto = Awaited<ReturnType<GetStaffRequest["execute"]>>;
