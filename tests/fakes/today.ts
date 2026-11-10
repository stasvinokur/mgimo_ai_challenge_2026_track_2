import { GetMyGrades } from "@/application/grades/get-my-grades";
import type { NotificationDto } from "@/application/notifications/ports";
import type { NotificationsFeedDto } from "@/application/notifications/use-cases";
import type { Actor } from "@/application/ports/actor";
import { type RequestDto, requestDto } from "@/application/requests/dto";
import { GetToday } from "@/application/schedule/get-schedule";
import { GetTodayOverview } from "@/application/today/get-today";
import type { TodaySources } from "@/application/today/ports";
import { notificationFixtures } from "../../scripts/fixtures/notifications";
import { gradesFixture } from "./grades";
import { enrollmentType } from "./requests";
import { change, FakeScheduleRepository, scheduleData, slot } from "./schedule";

export function todayFixture() {
  const d = gradesFixture();
  const repository = new FakeScheduleRepository();
  repository.records.set(
    d.ctx.row("student:anna").id,
    scheduleData({
      slots: [{ ...slot, weekday: 3 }],
      changes: [change({ date: "2026-11-04", newDate: "2026-11-04" })],
    }),
  );
  repository.records.set(
    d.ctx.row("student:timur").id,
    scheduleData({
      group: "ИМП-ДЕМО-1",
      slots: [{ ...slot, weekday: 3, course: "Основы маркетинга" }],
    }),
  );
  const requests = new Map<string, RequestDto[]>([
    [
      d.ctx.row("student:anna").id,
      [
        requestDto(
          {
            id: "ready",
            publicNo: "З-2026-000001",
            studentId: d.ctx.row("student:anna").id,
            facultyId: d.ctx.row("faculty:fmo").id,
            studentUserId: d.anna.userId,
            typeCode: enrollmentType.code,
            payload: {},
            status: "ready",
            assignee: null,
            submittedAt: "2026-11-02T09:00:00.000Z",
            dueAt: "2026-11-05T09:00:00.000Z",
            createdAt: "2026-11-02T09:00:00.000Z",
            updatedAt: "2026-11-04T08:00:00.000Z",
          },
          enrollmentType,
          d.clock.now(),
        ),
      ],
    ],
  ]);
  const fixtures = notificationFixtures(d.ctx).notifications;
  const notifications = new Map<string, NotificationsFeedDto>();
  for (const actor of [d.anna, d.timur]) {
    const items: NotificationDto[] = fixtures
      .filter((item) => item.userId === actor.userId)
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        priority: item.priority ?? "normal",
        title: item.title,
        body: item.body,
        link: item.link ?? null,
        readAt: null,
        createdAt: item.createdAt?.toISOString() ?? d.clock.now().toISOString(),
      }));
    notifications.set(actor.userId, {
      high: items.filter((item) => item.priority === "high"),
      normal: items.filter((item) => item.priority === "normal"),
      digest: [],
      announcements: [],
    });
  }
  const calls: { source: keyof TodaySources; actor: Actor }[] = [];
  const failures = new Set<keyof TodaySources>();
  const getSchedule = new GetToday(repository, d.clock);
  const getGrades = new GetMyGrades(d.repository, d.clock);
  const sources: TodaySources = {
    schedule: (actor) => getSchedule.execute(actor),
    grades: (actor) => getGrades.execute(actor),
    requests: async (actor) =>
      structuredClone(
        actor.kind === "student" ? (requests.get(actor.studentId) ?? []) : [],
      ),
    notifications: async (actor) =>
      structuredClone(
        notifications.get(actor.userId) ?? {
          high: [],
          normal: [],
          digest: [],
          announcements: [],
        },
      ),
  };
  const traced = Object.fromEntries(
    Object.entries(sources).map(([key, source]) => [
      key,
      (actor: Actor) => {
        const name = key as keyof TodaySources;
        calls.push({ source: name, actor });
        if (failures.has(name))
          throw new Error("Ошибка источника: технические подробности");
        return source(actor);
      },
    ]),
  ) as unknown as TodaySources;
  return {
    ...d,
    scheduleRepository: repository,
    requests,
    notifications,
    calls,
    failures,
    sources: traced,
    overview: new GetTodayOverview(traced, d.clock),
  };
}
