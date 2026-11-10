import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import Loading from "@/app/(student)/today/loading";
import { GetWeek } from "@/application/schedule/get-schedule";
import type { TodayDto } from "@/application/today/get-today";
import { actionPresentation } from "@/ui/today/action-label";
import { TodayView } from "@/ui/today/today-view";
import { todayFixture } from "../fakes/today";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const profile = {
  ok: true as const,
  data: {
    fullName: "Анна Соколова",
    faculty: "ФМО",
    program: "Международные отношения",
    course: 2,
    group: "ДЕМО-2",
    recordBookNo: "DEMO-0001",
    scholarship: "increased" as const,
  },
};
const render = (data: TodayDto) =>
  renderToStaticMarkup(createElement(TodayView, { data, profile }));

it("приветствие с именем, кольцо из DTO и шесть дней в единственном дереве", async () => {
  const d = todayFixture();
  const data = await d.overview.execute(d.anna);
  const week = await new GetWeek(d.scheduleRepository, d.clock).execute(d.anna);
  const html = renderToStaticMarkup(
    createElement(TodayView, { data, profile, week: { ok: true, data: week } }),
  );
  expect(html).toContain("Добрый день, Анна");
  expect(html).toContain("Среда, 4 ноября");
  expect(html.match(/data-testid="today-week-day"/g)).toHaveLength(6);
  expect(html.match(/aria-current="date"/g)).toHaveLength(1);
  expect(html).toContain("Свободный день");
  expect(html).toContain("Перенос");
  expect(html).toContain('href="/schedule?view=week&amp;week=2026-W45"');
  expect(html.match(/data-testid="day-pulse"/g)).toHaveLength(1);
  expect(html.match(/data-testid="today-action"/g)).toHaveLength(
    data.actions.length,
  );
  if (!data.study.ok) throw new Error("Нужна учёба.");
  const score = new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 1,
  }).format(data.study.data.summary.averageScore ?? 0);
  expect(html).toContain(
    `aria-label="${score} из ${data.study.data.summary.targetScore}"`,
  );
});

it("все четыре вида изменений выводят зачёркнутое старое, новое и причину ровно один раз", async () => {
  const d = todayFixture();
  const data = await d.overview.execute(d.anna);
  if (!data.schedule.ok) throw new Error("Нужно расписание.");
  const lesson = data.schedule.data.changes[0];
  const original = lesson?.changes[0];
  if (!lesson || !original) throw new Error("Нужно изменение.");
  const kinds = ["moved", "room", "cancelled", "replaced"] as const;
  data.schedule.data.changes = kinds.flatMap((kind) => {
    const item = {
      ...lesson,
      changes: [
        {
          ...original,
          id: kind,
          kind,
          reason: `Причина ${kind}`,
          after: { ...original.after, teacher: "Олег Яснев" },
        },
      ],
    };
    return [item, item];
  });
  const html = render(data);
  expect(html.match(/data-testid="today-change"/g)).toHaveLength(4);
  expect(html.match(/<s>/g)).toHaveLength(4);
  for (const kind of kinds)
    expect(html.match(new RegExp(`Причина ${kind}`, "g"))).toHaveLength(1);
  for (const label of [
    "Перенос",
    "Смена аудитории",
    "Отмена занятия",
    "Замена преподавателя",
    "занятие отменено",
    "Олег Яснев",
    "Светлана Рощина",
  ])
    expect(html).toContain(label);
  expect(html).toContain("Ауд. 405</s>");
  expect(html).toContain("<strong>Ауд. 312</strong>");
});

it("после последней пары состояние завершения сохраняет ближайшую пару", async () => {
  const d = todayFixture();
  d.clock.set("2026-11-04T16:00:00Z");
  const html = render(await d.overview.execute(d.anna));
  expect(html).toContain("Пары на сегодня закончились");
  expect(html).toContain("Ближайшая пара");
  expect(html).toContain("11 ноября");
});

it("при отсутствии оценок кольца нет, цель не превращается в выдуманный ноль", async () => {
  const d = todayFixture();
  const data = await d.overview.execute(d.anna);
  if (!data.study.ok) throw new Error("Нужна учёба.");
  data.study.data.summary.averageScore = null;
  const html = render(data);
  expect(html).toContain("Оценок пока нет");
  expect(html).not.toContain('class="progress-ring"');
});

it("заявки показывают этапы и собственные ссылки, все «ещё N» сохранены", async () => {
  const d = todayFixture();
  const data = await d.overview.execute(d.anna);
  data.requests = {
    ok: true,
    data: {
      total: 3,
      active: [
        {
          id: "own-1",
          title: "Справка об обучении",
          status: "submitted",
          dueAt: null,
          sla: null,
        },
        {
          id: "own-2",
          title: "Справка о стипендии",
          status: "in_progress",
          dueAt: "2026-11-05T09:00:00Z",
          sla: "soon",
        },
        {
          id: "own-3",
          title: "Заявление",
          status: "accepted",
          dueAt: "2026-11-03T09:00:00Z",
          sla: "overdue",
        },
      ],
    },
  };
  data.more = [
    { section: "grades", count: 2, href: "/grades" },
    { section: "requests", count: 1, href: "/requests" },
  ];
  const html = render(data);
  expect(html.match(/data-testid="today-request"/g)).toHaveLength(3);
  for (const stage of [1, 2, 3])
    expect(html).toContain(`aria-label="этап ${stage} из 5"`);
  for (const id of ["own-1", "own-2", "own-3"])
    expect(html).toContain(`href="/requests/${id}"`);
  expect(html).toContain("Ожидаемая дата:");
  expect(html).toContain("Срок появится после обработки заявки.");
  expect(html).toContain("Учёба (ещё 2)");
  expect(html).toContain("Заявки (ещё 1)");
});

it.each(["schedule", "grades", "requests", "notifications"] as const)(
  "ошибка %s остаётся в своём блоке с одним повтором",
  async (source) => {
    const d = todayFixture();
    d.failures.add(source);
    const html = render(await d.overview.execute(d.anna));
    const label = {
      schedule: "Расписание",
      grades: "Учёба",
      requests: "Заявки",
      notifications: "Уведомления",
    }[source];
    expect(
      html.match(new RegExp(`${label}: не удалось загрузить`, "g")),
    ).toHaveLength(1);
    expect(html).toContain("Требует действия");
    expect(html).not.toContain("технические подробности");
    if (source !== "grades")
      expect(html).toContain('data-testid="today-study"');
    if (source !== "schedule")
      expect(html).toContain('data-testid="day-pulse"');
  },
);

it("недоступные неделя и профиль не скрывают карточки; у скелетона нет интерактивных дублей", async () => {
  const d = todayFixture();
  const html = renderToStaticMarkup(
    createElement(TodayView, {
      data: await d.overview.execute(d.anna),
      profile: { ok: false },
      week: { ok: false },
    }),
  );
  for (const name of ["Неделя", "Профиль"])
    expect(html).toContain(`${name}: не удалось загрузить`);
  expect(html).toContain('data-testid="day-pulse"');
  expect(html).toContain('data-testid="today-study"');
  const loading = renderToStaticMarkup(createElement(Loading));
  expect(loading).toContain('role="status"');
  expect(loading).toContain('data-variant="hero"');
  expect(loading).toContain("grid-cols-6");
  expect(loading).not.toMatch(/<(button|input|a)[\s>]/);
});

it.each([
  ["debt", "danger"],
  ["unreachable", "danger"],
  ["at-risk", "warning"],
  ["clarification", "warning"],
  ["retained", "success"],
  ["eligible", "success"],
] as const)(
  "тон кольца %s следует прогнозу даже при среднем выше цели",
  async (state, tone) => {
    const d = todayFixture();
    const data = await d.overview.execute(d.anna);
    if (!data.study.ok) throw new Error("Нужна учёба.");
    data.study.data.scholarship.state = state;
    data.study.data.summary.averageScore = 89.5;
    data.study.data.summary.targetScore = 86;
    const html = render(data);
    expect(html).toContain(`data-tone="${tone}"`);
    expect(html).toContain(`--progress-ink:var(--${tone}-ink)`);
    expect(html).toContain('aria-label="89,5 из 86"');
  },
);

it.each(["anna", "timur"] as const)(
  "действия %s имеют контекст в доступном имени, имя hero остаётся единственным",
  async (account) => {
    const d = todayFixture();
    const data = await d.overview.execute(d[account]);
    const html = render(data);
    expect(html.match(/>Открыть расписание<\/a>/g)).toHaveLength(1);
    expect(html.match(/>Открыть успеваемость<\/a>/g)).toHaveLength(1);
    expect(html).toMatch(/href="\/grades">Открыть успеваемость<\/a>/);
    expect(html).toContain('class="today-meta-line"');
    expect(html.match(/class="[^"]*\btoday-action-link\b[^"]*"/g)).toHaveLength(
      data.actions.length,
    );
    expect(html).not.toMatch(/class="[^"]*\bundefined\b/);
    for (const item of data.actions)
      expect(html).toContain(
        `<span class="sr-only">: ${actionPresentation(item).title}</span>`,
      );
    expect(html).toContain("<h1>Сегодня</h1>");
    if (account === "anna")
      expect(html).toContain(
        '>Посмотреть изменения<span class="sr-only">: Пара перенесена</span>',
      );
  },
);
