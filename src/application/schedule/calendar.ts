import { addDays, moscowDate, weekStart } from "@/domain/schedule/dates";
import { renderCalendar } from "@/domain/schedule/ics";
import { buildSchedule } from "@/domain/schedule/schedule";
import type { Actor } from "../ports/actor";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import type {
  CalendarTokenStore,
  CalendarTokens,
  ScheduleRepository,
} from "./ports";
import { calendarTokenSchema, parseCalendarAction } from "./schemas";

export class RenewCalendarToken {
  constructor(
    private readonly store: CalendarTokenStore,
    private readonly tokens: CalendarTokens,
    private readonly ids: IdGenerator,
    private readonly repository: ScheduleRepository,
  ) {}

  async execute(actor: Actor, input: unknown = {}) {
    if (actor.kind !== "student") throw new ForbiddenError();
    parseCalendarAction(input);
    if (!(await this.repository.findForStudent(actor.studentId)))
      throw new NotFoundError();
    const token = this.tokens.generate();
    await this.store.replaceForStudent(
      actor.studentId,
      this.ids.next(),
      this.tokens.hash(token),
    );
    return { path: `/api/calendar/${token}` };
  }
}

export class GetCalendar {
  constructor(
    private readonly store: CalendarTokenStore,
    private readonly tokens: CalendarTokens,
    private readonly repository: ScheduleRepository,
    private readonly clock: Clock,
  ) {}

  async execute(token: unknown, actor: Actor | null = null): Promise<string> {
    const parsed = calendarTokenSchema.safeParse(token);
    if (!parsed.success) throw new NotFoundError();
    const studentId = await this.store.findStudentByHash(
      this.tokens.hash(parsed.data),
    );
    if (
      !studentId ||
      (actor && (actor.kind !== "student" || actor.studentId !== studentId))
    )
      throw new NotFoundError();
    const data = await this.repository.findForStudent(studentId);
    if (!data) throw new NotFoundError();
    const start = weekStart(moscowDate(this.clock.now()));
    return renderCalendar(buildSchedule(data, start, addDays(start, 27)));
  }
}
