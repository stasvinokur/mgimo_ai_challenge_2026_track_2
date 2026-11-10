import {
  addDays,
  dateFromWeek,
  isoWeek,
  moscowDate,
  weekStart,
} from "@/domain/schedule/dates";
import {
  buildSchedule,
  daySummary,
  type Lesson,
} from "@/domain/schedule/schedule";
import type { Actor } from "../ports/actor";
import type { Clock } from "../ports/clock";
import { ForbiddenError, NotFoundError } from "../shared/errors";
import type { ScheduleRepository } from "./ports";
import { parseScheduleQuery } from "./schemas";

export type {
  Lesson,
  LessonChange,
  LessonTime,
} from "@/domain/schedule/schedule";

export interface WeekScheduleDto {
  group: string;
  week: string;
  previousWeek: string;
  nextWeek: string;
  currentWeek: string;
  today: string;
  now: string;
  days: { date: string; lessons: Lesson[] }[];
}

export interface TodayScheduleDto {
  group: string;
  date: string;
  now: string;
  lessons: Lesson[];
  changes: Lesson[];
  current: Lesson | null;
  next: Lesson | null;
  minutesUntilNext: number | null;
  nextStudyDate: string | null;
}

export class GetWeek {
  constructor(
    private readonly repository: ScheduleRepository,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, input: unknown = {}): Promise<WeekScheduleDto> {
    if (actor.kind !== "student") throw new ForbiddenError();
    const query = parseScheduleQuery(input);
    const now = this.clock.now();
    const today = moscowDate(now);
    const week = query.week ?? isoWeek(today);
    const start = dateFromWeek(week);
    const data = await this.repository.findForStudent(actor.studentId);
    if (!data) throw new NotFoundError();
    const lessons = buildSchedule(data, start, addDays(start, 6));
    return {
      group: data.group,
      week,
      previousWeek: isoWeek(addDays(start, -7)),
      nextWeek: isoWeek(addDays(start, 7)),
      currentWeek: isoWeek(today),
      today,
      now: now.toISOString(),
      days: Array.from({ length: 7 }, (_, index) => {
        const date = addDays(start, index);
        return {
          date,
          lessons: lessons.filter((lesson) => lesson.date === date),
        };
      }),
    };
  }
}

export class GetToday {
  constructor(
    private readonly repository: ScheduleRepository,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, input: unknown = {}): Promise<TodayScheduleDto> {
    if (actor.kind !== "student") throw new ForbiddenError();
    parseScheduleQuery(input);
    const now = this.clock.now();
    const date = moscowDate(now);
    const data = await this.repository.findForStudent(actor.studentId);
    if (!data) throw new NotFoundError();
    // After the last exception, two parity cycles contain every regular slot.
    let end = addDays(date, 14);
    for (const change of data.changes) {
      for (const affectedDate of [change.date, change.newDate]) {
        if (affectedDate && addDays(affectedDate, 14) > end)
          end = addDays(affectedDate, 14);
      }
    }
    const lessons = buildSchedule(data, date, end);
    const todayLessons = lessons.filter((lesson) => lesson.date === date);
    return {
      group: data.group,
      date,
      now: now.toISOString(),
      lessons: todayLessons,
      changes: [
        ...new Map(
          todayLessons
            .filter((lesson) => lesson.changes.length > 0)
            .map((lesson) => [lesson.uid, lesson]),
        ).values(),
      ],
      ...daySummary(lessons, date, now),
    };
  }
}

export const scheduleDates = { isoWeek, weekStart, addDays, dateFromWeek };
