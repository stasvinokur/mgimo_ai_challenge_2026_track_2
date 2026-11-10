import { expect, it } from "vitest";
import { ForbiddenError } from "@/application/shared/errors";
import { GetTodayOverview } from "@/application/today/get-today";
import type { TodaySources } from "@/application/today/ports";
import { staff } from "../fakes/schedule";
import { todayFixture } from "../fakes/today";

it("Анна: перенос, дисциплина на грани, готовая справка, сессия и тот же Actor", async () => {
  const d = todayFixture();
  const result = await d.overview.execute(d.anna);
  expect(result.schedule).toMatchObject({
    ok: true,
    data: {
      changes: [
        expect.objectContaining({ course: "История международных отношений" }),
      ],
      minutesUntilNext: 60,
    },
  });
  expect(result.actions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        message: {
          code: "course",
          course: "Иностранный язык",
          state: "risk",
          advice: "calculate",
        },
        href: expect.stringMatching(/^\/grades\//),
      }),
      expect.objectContaining({
        message: expect.objectContaining({ code: "request", status: "ready" }),
        href: "/requests/ready",
        label: "getCertificate",
      }),
      expect.objectContaining({
        message: expect.objectContaining({
          code: "work",
          work: "Итоговый тест",
        }),
        dueAt: expect.any(String),
      }),
    ]),
  );
  expect(result.study).toMatchObject({
    ok: true,
    data: {
      summary: { inGoodShape: 5, needsAttention: 1 },
      session: { days: 14 },
    },
  });
  expect(d.calls).toHaveLength(4);
  expect(d.calls.every((call) => call.actor === d.anna)).toBe(true);
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
});

it("Тимур: долг первым, спокойное пустое состояние заявок, чужих данных нет", async () => {
  const d = todayFixture();
  const result = await d.overview.execute(d.timur);
  expect(result.actions[0]).toMatchObject({
    message: {
      code: "course",
      course: "Основы маркетинга",
      state: "debt",
      advice: "submitRequired",
    },
    urgency: "overdue",
  });
  expect(result.requests).toEqual({ ok: true, data: { total: 0, active: [] } });
  expect(result.study).toMatchObject({
    ok: true,
    data: { summary: { openDebts: 1 } },
  });
  expect(JSON.stringify(result)).not.toContain("Иностранный язык");
  expect(JSON.stringify(result)).not.toContain("/requests/ready");
});

it("день без пар сохраняет ближайшую учебную дату", async () => {
  const d = todayFixture();
  d.clock.set("2026-11-08T09:00:00Z");
  expect((await d.overview.execute(d.anna)).schedule).toMatchObject({
    ok: true,
    data: { lessons: [], current: null, nextStudyDate: "2026-11-11" },
  });
});

it.each(["schedule", "grades", "requests", "notifications"] as const)(
  "сбой %s изолирован, остальные источники и действия доступны",
  async (source) => {
    const d = todayFixture();
    d.failures.add(source);
    const result = await d.overview.execute(d.anna);
    const fields = {
      schedule: result.schedule,
      grades: result.study,
      requests: result.requests,
      notifications: result.notifications,
    };
    for (const key of Object.keys(fields) as (keyof TodaySources)[])
      expect(fields[key].ok).toBe(key !== source);
    expect(d.calls).toHaveLength(4);
    expect(result.actions.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain("технические подробности");
  },
);

it("источники начинают работу независимо, без последовательного ожидания", async () => {
  const d = todayFixture();
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const result = new GetTodayOverview(
    {
      ...d.sources,
      schedule: async (actor) => {
        await pending;
        return d.sources.schedule(actor);
      },
      grades: async (actor) => {
        calls++;
        return d.sources.grades(actor);
      },
      requests: async (actor) => {
        calls++;
        return d.sources.requests(actor);
      },
      notifications: async (actor) => {
        calls++;
        return d.sources.notifications(actor);
      },
    },
    d.clock,
  ).execute(d.anna);
  await Promise.resolve();
  expect(calls).toBe(3);
  release?.();
  await expect(result).resolves.toHaveProperty("schedule.ok", true);
});

it("сотруднику запрещено чтение до обращения к источникам", async () => {
  const d = todayFixture();
  await expect(d.overview.execute(staff)).rejects.toThrow(ForbiddenError);
  expect(d.calls).toHaveLength(0);
});

it("не больше пяти действий, остальное ведёт в свой раздел; каждое действие внутреннее", async () => {
  const d = todayFixture();
  const feed = d.notifications.get(d.anna.userId);
  const template = feed?.high[0];
  if (!feed || !template) throw new Error("Нет уведомлений.");
  for (let i = 0; i < 8; i++)
    feed.high.push({
      ...template,
      id: `extra-${i}`,
      link: "https://example.com",
    });
  const result = await d.overview.execute(d.anna);
  expect(result.actions).toHaveLength(5);
  expect(result.more).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ section: "grades", href: "/grades" }),
      expect.objectContaining({
        section: "notifications",
        href: "/notifications",
      }),
    ]),
  );
  expect(
    result.actions.every(
      (item) => item.href.startsWith("/") && !item.href.startsWith("//"),
    ),
  ).toBe(true);
  expect(result.more.reduce((sum, item) => sum + item.count, 0)).toBe(8);
});

it("только важные непрочитанные уведомления; пустая или внешняя ссылка ведёт в ленту", async () => {
  const d = todayFixture();
  const feed = d.notifications.get(d.anna.userId);
  if (!feed?.high[0] || !feed.high[1]) throw new Error("Нет уведомлений.");
  feed.high[0].readAt = d.clock.now().toISOString();
  feed.high[1].link = "//example.com";
  const result = await d.overview.execute(d.anna);
  const actions = result.actions.filter(
    (item) => item.section === "notifications",
  );
  expect(actions).toHaveLength(1);
  expect(actions[0]?.href).toBe("/notifications");
});

it("граница семи дней включительна, прошедшие работы и сегодняшний московский срок сортируются раньше", async () => {
  const d = todayFixture();
  const record = d.records.get(d.ctx.row("student:anna").id);
  const course = record?.courses[0];
  if (!record || !course) throw new Error("Нет дисциплины.");
  record.courses = [course];
  course.works = [
    {
      id: "past",
      title: "Просроченная",
      weight: 20,
      maxScore: 100,
      score: null,
      isRequired: false,
      dueAt: "2026-11-03T20:00:00.000Z",
    },
    {
      id: "today",
      title: "Сегодня",
      weight: 20,
      maxScore: 100,
      score: null,
      isRequired: false,
      dueAt: "2026-11-04T20:59:00.000Z",
    },
    {
      id: "edge",
      title: "Через семь дней",
      weight: 20,
      maxScore: 100,
      score: null,
      isRequired: false,
      dueAt: "2026-11-11T09:00:00.000Z",
    },
    {
      id: "after",
      title: "Позже",
      weight: 40,
      maxScore: 100,
      score: null,
      isRequired: false,
      dueAt: "2026-11-11T09:00:00.001Z",
    },
  ];
  d.notifications.clear();
  d.requests.clear();
  const result = await d.overview.execute(d.anna);
  expect(result.actions.map((item) => item.id)).toEqual([
    "work:past",
    "work:today",
    `course:${course.id}`,
    "work:edge",
  ]);
  expect(result.actions.map((item) => item.urgency)).toEqual([
    "overdue",
    "today",
    "soon",
    "soon",
  ]);
});

it("Нужна информация — конкретное действие; в работе — ожидаемая дата без технического enum", async () => {
  const d = todayFixture();
  const items = d.requests.get(d.ctx.row("student:anna").id);
  const ready = items?.[0];
  if (!items || !ready) throw new Error("Нет заявки.");
  d.notifications.clear();
  items.push(
    {
      ...ready,
      id: "clarify",
      status: "needs_info",
      dueAt: "2026-11-03T09:00:00Z",
    },
    { ...ready, id: "active", status: "in_progress", sla: "soon" },
  );
  const result = await d.overview.execute(d.anna);
  expect(result.actions[0]).toMatchObject({
    href: "/requests/clarify",
    label: "clarifyRequest",
    urgency: "overdue",
  });
  expect(result.requests).toMatchObject({
    ok: true,
    data: {
      active: [{ status: "in_progress", sla: "soon", dueAt: ready.dueAt }],
    },
  });
});

it("полностью пустые источники дают сериализуемый пустой обзор", async () => {
  const d = todayFixture();
  const record = d.records.get(d.ctx.row("student:anna").id);
  if (!record) throw new Error("Нет данных.");
  record.courses = [];
  d.requests.clear();
  d.notifications.clear();
  const result = await d.overview.execute(d.anna);
  expect(result.actions).toEqual([]);
  expect(result.more).toEqual([]);
  expect(result.study).toMatchObject({ ok: true, data: { session: null } });
});

it("московская полночь определяет сегодняшний срок и календарные дни до сессии", async () => {
  const d = todayFixture();
  d.clock.set("2026-11-04T21:30:00Z");
  const record = d.records.get(d.ctx.row("student:anna").id);
  const course = record?.courses[0];
  if (!record || !course) throw new Error("Нет дисциплины.");
  record.courses = [course];
  course.works = [
    {
      id: "midnight",
      title: "Ночной срок",
      weight: 100,
      maxScore: 100,
      score: null,
      isRequired: true,
      dueAt: "2026-11-04T22:00:00.000Z",
    },
  ];
  course.exams = [
    {
      id: "session",
      kind: "exam",
      room: "ДЕМО-101",
      at: "2026-11-05T22:00:00.000Z",
    },
  ];
  d.requests.clear();
  d.notifications.clear();
  const data = await d.overview.execute(d.anna);
  expect(
    data.actions.find((item) => item.id === "work:midnight")?.urgency,
  ).toBe("today");
  expect(data.study).toMatchObject({
    ok: true,
    data: { session: { days: 1 } },
  });
});
