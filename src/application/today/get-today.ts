import type { GradesDto } from "@/application/grades/get-my-grades";
import type { Actor } from "@/application/ports/actor";
import type { Clock } from "@/application/ports/clock";
import type { RequestDto, RequestStatus } from "@/application/requests/dto";
import type { TodayScheduleDto } from "@/application/schedule/get-schedule";
import { ForbiddenError } from "@/application/shared/errors";
import { isInternalNotificationLink } from "@/domain/notifications/quiet-mode";
import { moscowDate } from "@/domain/schedule/dates";
import type { TodaySources } from "./ports";

export type Source<T> = { ok: true; data: T } | { ok: false };
export type ActionSection = "grades" | "requests" | "notifications";
export interface TodayAction {
  id: string;
  section: ActionSection;
  message:
    | {
        code: "course";
        course: string;
        state: "debt" | "plan" | "risk";
        advice: "submitRequired" | "resit" | "calculate" | "improve";
      }
    | { code: "work"; course: string; work: string; overdue: boolean }
    | { code: "request"; title: string; status: "ready" | "needs_info" }
    | { code: "notification"; title: string; body: string };
  href: string;
  label:
    | "reviewCourse"
    | "openWork"
    | "getCertificate"
    | "openRequest"
    | "clarifyRequest"
    | "openNotifications";
  urgency: "overdue" | "today" | "soon";
  dueAt: string | null;
}

export interface TodayDto {
  asOf: string;
  schedule: Source<TodayScheduleDto>;
  study: Source<{
    summary: GradesDto["summary"];
    scholarship: {
      state: GradesDto["scholarship"]["outlook"]["state"];
      current: GradesDto["scholarship"]["currentScholarship"];
      level: GradesDto["scholarship"]["level"];
      goalLevel: "academic" | "increased" | null;
      goalReachable: boolean | null;
      debtCourse: string | null;
      requirement: {
        minimum: number;
        maxScore: number;
        title: string;
        course: string;
      } | null;
      moreRequirements: boolean;
    };
    session: { at: string; days: number } | null;
  }>;
  requests: Source<{
    total: number;
    active: {
      id: string;
      title: string;
      status: RequestStatus;
      dueAt: string | null;
      sla: RequestDto["sla"];
    }[];
  }>;
  notifications: Source<{ importantUnread: number }>;
  actions: TodayAction[];
  more: { section: ActionSection; href: string; count: number }[];
}

const day = 86_400_000;
const urgencyOrder = { overdue: 0, today: 1, soon: 2 };

export class GetTodayOverview {
  constructor(
    private readonly sources: TodaySources,
    private readonly clock: Clock,
  ) {}

  async execute(
    actor: Actor,
    _input: Record<string, never> = {},
  ): Promise<TodayDto> {
    if (actor.kind !== "student") throw new ForbiddenError();
    const now = this.clock.now();
    const asOf = now.toISOString();
    const today = moscowDate(now);
    // Defer each call so even a synchronous source failure stays isolated.
    const [schedule, grades, requests, notifications] =
      await Promise.allSettled([
        Promise.resolve().then(() => this.sources.schedule(actor)),
        Promise.resolve().then(() => this.sources.grades(actor)),
        Promise.resolve().then(() => this.sources.requests(actor)),
        Promise.resolve().then(() => this.sources.notifications(actor)),
      ]);
    const actions: TodayAction[] = [];
    const urgency = (at: string): TodayAction["urgency"] =>
      Date.parse(at) < now.getTime()
        ? "overdue"
        : moscowDate(new Date(at)) === today
          ? "today"
          : "soon";
    let study: TodayDto["study"] = { ok: false };
    if (grades.status === "fulfilled") {
      const { courses, summary } = grades.value;
      const sessionAt = courses
        .flatMap((course) => course.exams.map((exam) => exam.at))
        .filter((at) => at >= asOf)
        .sort()[0];
      const scholarship = grades.value.scholarship;
      const requirements =
        scholarship.next?.courses.flatMap((course) =>
          course.requirements.map((work) => ({
            ...work,
            course: course.title,
          })),
        ) ?? [];
      const firstRequirement = requirements.find((work) => work.minimum > 0);
      study = {
        ok: true,
        data: {
          summary,
          scholarship: {
            state: scholarship.outlook.state,
            current: scholarship.currentScholarship,
            level: scholarship.level,
            goalLevel: scholarship.next
              ? scholarship.next.level === "increased"
                ? "increased"
                : "academic"
              : null,
            goalReachable: scholarship.next?.reachable ?? null,
            debtCourse:
              courses.find((course) => course.openDebts > 0)?.title ?? null,
            requirement: firstRequirement
              ? {
                  minimum: firstRequirement.minimum,
                  maxScore: firstRequirement.maxScore,
                  title: firstRequirement.title,
                  course: firstRequirement.course,
                }
              : null,
            moreRequirements: requirements.length > 1,
          },
          session: sessionAt
            ? {
                at: sessionAt,
                days: Math.round(
                  (Date.parse(moscowDate(new Date(sessionAt))) -
                    Date.parse(today)) /
                    day,
                ),
              }
            : null,
        },
      };
      for (const course of courses) {
        if (course.light.tone === "warning" || course.light.tone === "danger") {
          actions.push({
            id: `course:${course.id}`,
            section: "grades",
            message: {
              code: "course",
              course: course.title,
              state:
                course.openDebts > 0
                  ? "debt"
                  : course.light.tone === "danger"
                    ? "plan"
                    : "risk",
              advice:
                course.openDebts > 0
                  ? "submitRequired"
                  : course.light.tone === "danger"
                    ? "resit"
                    : course.forecast?.targetReachable
                      ? "calculate"
                      : "improve",
            },
            href: `/grades/${encodeURIComponent(course.id)}`,
            label: "reviewCourse",
            urgency: course.openDebts > 0 ? "overdue" : "soon",
            dueAt: null,
          });
        }
        for (const work of course.works) {
          if (
            work.status === "graded" ||
            (course.openDebts > 0 &&
              work.isRequired &&
              work.status === "overdue") ||
            Date.parse(work.dueAt) > now.getTime() + 7 * day
          )
            continue;
          actions.push({
            id: `work:${work.id}`,
            section: "grades",
            message: {
              code: "work",
              course: course.title,
              work: work.title,
              overdue: work.status === "overdue",
            },
            href: `/grades/${encodeURIComponent(course.id)}`,
            label: "openWork",
            urgency: urgency(work.dueAt),
            dueAt: work.dueAt,
          });
        }
      }
    }
    let requestSummary: TodayDto["requests"] = { ok: false };
    if (requests.status === "fulfilled") {
      requestSummary = {
        ok: true,
        data: {
          total: requests.value.length,
          active: requests.value
            .filter((item) =>
              ["submitted", "accepted", "in_progress"].includes(item.status),
            )
            .map((item) => ({
              id: item.id,
              title: item.type.title,
              status: item.status,
              dueAt: item.dueAt,
              sla: item.sla,
            })),
        },
      };
      for (const item of requests.value) {
        if (item.status !== "needs_info" && item.status !== "ready") continue;
        actions.push({
          id: `request:${item.id}`,
          section: "requests",
          message: {
            code: "request",
            title: item.type.title,
            status: item.status,
          },
          href: `/requests/${encodeURIComponent(item.id)}`,
          label:
            item.status === "ready"
              ? item.type.isCertificate
                ? "getCertificate"
                : "openRequest"
              : "clarifyRequest",
          urgency:
            item.status === "needs_info" && item.dueAt
              ? urgency(item.dueAt)
              : "today",
          dueAt: item.status === "needs_info" ? item.dueAt : null,
        });
      }
    }
    let notificationSummary: TodayDto["notifications"] = { ok: false };
    if (notifications.status === "fulfilled") {
      const unread = notifications.value.high.filter((item) => !item.readAt);
      notificationSummary = {
        ok: true,
        data: { importantUnread: unread.length },
      };
      for (const item of unread) {
        actions.push({
          id: `notification:${item.id}`,
          section: "notifications",
          message: { code: "notification", title: item.title, body: item.body },
          href:
            item.link && isInternalNotificationLink(item.link)
              ? item.link
              : "/notifications",
          label: "openNotifications",
          urgency: "today",
          dueAt: null,
        });
      }
    }
    actions.sort(
      (a, b) =>
        urgencyOrder[a.urgency] - urgencyOrder[b.urgency] ||
        (a.dueAt ?? asOf).localeCompare(b.dueAt ?? asOf) ||
        a.id.localeCompare(b.id),
    );
    const remaining = actions.slice(5);
    return {
      asOf,
      schedule:
        schedule.status === "fulfilled"
          ? { ok: true, data: schedule.value }
          : { ok: false },
      study,
      requests: requestSummary,
      notifications: notificationSummary,
      actions: actions.slice(0, 5),
      more: (["grades", "requests", "notifications"] as const).flatMap(
        (section) => {
          const count = remaining.filter(
            (item) => item.section === section,
          ).length;
          return count ? [{ section, href: `/${section}`, count }] : [];
        },
      ),
    };
  }
}
