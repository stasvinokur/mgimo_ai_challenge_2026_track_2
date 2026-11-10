import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { formatCountdown } from "@/application/today/countdown";
import { actionPresentation } from "@/ui/today/action-label";
import { buildTodayBriefing } from "@/ui/today/briefing";
import { TodayBriefingCard } from "@/ui/today/briefing-card";
import { todayFixture } from "../fakes/today";

async function moveBriefing(date = "Сегодня") {
  const d = todayFixture();
  const data = await d.overview.execute(d.anna);
  const notice = data.actions.find((item) => item.href === "/schedule");
  const next = data.actions.find((item) => item.href !== "/schedule");
  if (!notice || !next || notice.message.code !== "notification")
    throw new Error("Нужны уведомление о переносе и другое действие.");
  return {
    data,
    notice: {
      ...notice,
      message: {
        ...notice.message,
        body: `${date}: занятие перенесено на 13:00, аудитория 312.`,
      },
    },
    next,
  };
}

it("утро Анны: ближайшая пара, один перенос, одно главное действие и факты стипендии", async () => {
  const d = todayFixture();
  const data = await d.overview.execute(d.anna);
  const before = structuredClone(data);
  const phrases = buildTodayBriefing(data, data.asOf);
  expect(phrases).toHaveLength(4);
  expect(phrases[0]).toBe(
    "Через 1 час — «История международных отношений», аудитория 312.",
  );
  expect(phrases[1]).toBe(
    "Изменение: занятие «История международных отношений» перенесено на 13:00 МСК, аудитория 312.",
  );
  const action = data.actions[0];
  if (!action) throw new Error("Нужно главное действие.");
  expect(phrases[2]).toBe(`Главное: ${actionPresentation(action).title}.`);
  expect(phrases[3]).toContain("77 из 100");
  expect(
    phrases.filter((phrase) => phrase.startsWith("Изменение:")),
  ).toHaveLength(1);
  expect(data).toEqual(before);
  expect(buildTodayBriefing(data, data.asOf)).toEqual(phrases);
});

it.each(["Сегодня", "4 ноября"])(
  "перенос с датой «%s» уже описан: берётся следующее действие",
  async (date) => {
    const { data, notice, next } = await moveBriefing(date);
    data.actions = [notice, next];
    const phrases = buildTodayBriefing(data, data.asOf);
    expect(phrases).not.toContain("Главное: Пара перенесена.");
    expect(phrases).toContain(`Главное: ${actionPresentation(next).title}.`);
    expect(
      phrases.filter((phrase) => phrase.startsWith("Изменение:")),
    ).toHaveLength(1);
  },
);

it("если осталось только повторное уведомление, фраза действия пропускается без ложного спокойствия", async () => {
  const { data, notice } = await moveBriefing();
  data.actions = [notice];
  const phrases = buildTodayBriefing(data, data.asOf);
  expect(phrases.some((phrase) => phrase.startsWith("Главное:"))).toBe(false);
  expect(phrases).not.toContain("Срочных дел сейчас нет.");
  expect(phrases[1]).toContain("перенесено на 13:00 МСК, аудитория 312");
});

it.each([
  { body: "5 ноября: занятие перенесено на 13:00, аудитория 312." },
  { body: "Сегодня: занятие перенесено на 15:00, аудитория 312." },
  { body: "Сегодня: занятие перенесено на 13:00, аудитория 405." },
  { title: "Изменился план консультаций" },
  { href: "/schedule-other" },
])("другое уведомление расписания не теряется: %j", async (different) => {
  const { data, notice } = await moveBriefing();
  const { href, ...message } = different;
  const action = {
    ...notice,
    href: href ?? notice.href,
    message: { ...notice.message, ...message },
  };
  data.actions = [action];
  expect(buildTodayBriefing(data, data.asOf)).toContain(
    `Главное: ${actionPresentation(action).title}.`,
  );
});

it.each(["failed", "empty"] as const)(
  "уведомление сохраняется, если изменение не показано: %s",
  async (state) => {
    const { data, notice } = await moveBriefing();
    data.actions = [notice];
    if (state === "failed") data.schedule = { ok: false };
    else if (data.schedule.ok) data.schedule.data.changes = [];
    expect(buildTodayBriefing(data, data.asOf)).toContain(
      "Главное: Пара перенесена.",
    );
  },
);

it("перенос на другой день сохраняет дату", async () => {
  const { data } = await moveBriefing();
  if (!data.schedule.ok) throw new Error("Нужно расписание.");
  for (const lesson of data.schedule.data.changes)
    for (const change of lesson.changes)
      change.after.startsAt = "2026-11-05T10:00:00.000Z";
  expect(buildTodayBriefing(data, data.asOf)[1]).toBe(
    "Изменение: занятие «История международных отношений» перенесено на 5 ноября, 13:00 МСК, аудитория 312.",
  );
});

it("сегодня для переноса определяется по московскому дню через полночь UTC", async () => {
  const { data } = await moveBriefing();
  if (!data.schedule.ok) throw new Error("Нужно расписание.");
  for (const lesson of data.schedule.data.changes)
    for (const change of lesson.changes)
      change.after.startsAt = "2026-11-04T22:00:00.000Z";
  const result = buildTodayBriefing(data, "2026-11-05T00:00:00.000Z");
  expect(result.find((phrase) => phrase.startsWith("Изменение:"))).toBe(
    "Изменение: занятие «История международных отношений» перенесено на 01:00 МСК, аудитория 312.",
  );
});

it("идущая пара и переход к следующему состоянию используют now, а не устаревший статус", async () => {
  const d = todayFixture();
  const data = await d.overview.execute(d.anna);
  expect(buildTodayBriefing(data, "2026-11-04T10:15:00.000Z")[0]).toBe(
    "Сейчас идёт «История международных отношений» до 14:30 МСК, аудитория 312.",
  );
  expect(buildTodayBriefing(data, "2026-11-04T11:30:00.000Z")[0]).toBe(
    "Пары на сегодня закончились.",
  );
});

it.each([
  [1, "Начинается сейчас"],
  [59_999, "Начинается сейчас"],
  [60_000, "Через 1 минуту"],
  [60_001, "Через 2 минуты"],
  [5 * 60_000, "Через 5 минут"],
  [21 * 60_000, "Через 21 минуту"],
  [59 * 60_000 + 1, "Через 1 час"],
  [61 * 60_000, "Через 1 час 1 минуту"],
  [121 * 60_000, "Через 2 часа 1 минуту"],
] as const)(
  "до пары %s мс: тот же отсчёт, что у Пульса",
  async (delta, expected) => {
    const d = todayFixture();
    const data = await d.overview.execute(d.anna);
    if (!data.schedule.ok || !data.schedule.data.next)
      throw new Error("Нужна пара.");
    const startsAt = data.schedule.data.next.startsAt;
    const now = new Date(Date.parse(startsAt) - delta).toISOString();
    const pulse = formatCountdown(startsAt, now);
    expect(buildTodayBriefing(data, now)[0]).toBe(
      `${expected} — «История международных отношений», аудитория 312.`,
    );
    expect(pulse.match(/\d+/g)).toEqual(expected.match(/\d+/g));
  },
);

it("день без пар сохраняет ближайшую дату и московское время", async () => {
  const d = todayFixture();
  d.clock.set("2026-11-08T09:00:00.000Z");
  const data = await d.overview.execute(d.anna);
  const phrases = buildTodayBriefing(data, data.asOf);
  expect(phrases[0]).toBe("Сегодня пар нет.");
  expect(phrases[1]).toBe(
    "11 ноября в 09:00 — «История международных отношений», аудитория 405, время МСК.",
  );
  expect(phrases.length).toBeLessThanOrEqual(5);
});

it("московская полночь: завтра — по календарю МСК, а не UTC", async () => {
  const d = todayFixture();
  const data = await d.overview.execute(d.anna);
  if (!data.schedule.ok || !data.schedule.data.next)
    throw new Error("Нужна пара.");
  data.schedule.data.lessons = [];
  data.schedule.data.changes = [];
  data.schedule.data.next.startsAt = "2026-11-05T22:00:00.000Z";
  data.schedule.data.next.date = "2026-11-06";
  expect(buildTodayBriefing(data, "2026-11-04T21:30:00.000Z")[1]).toBe(
    "Завтра в 01:00 — «История международных отношений», аудитория 312, время МСК.",
  );
});

it("Тимур: долг звучит один раз, без повторной кнопки учебного действия", async () => {
  const d = todayFixture();
  const data = await d.overview.execute(d.timur);
  const phrases = buildTodayBriefing(data, data.asOf);
  expect(phrases.join(" ").match(/долг/g)).toHaveLength(1);
  expect(phrases.find((phrase) => phrase.startsWith("Главное:"))).toBe(
    "Главное: Основы маркетинга — есть долг.",
  );
  expect(phrases.join(" ")).not.toContain("Что можно сделать?");
  expect(phrases.length).toBeGreaterThanOrEqual(3);
});

it.each([
  [1, "1 долг"],
  [2, "2 долга"],
  [5, "5 долгов"],
  [21, "21 долг"],
])("долг без учебного действия: склонение %s", async (count, label) => {
  const d = todayFixture();
  const data = await d.overview.execute(d.timur);
  if (!data.study.ok) throw new Error("Нужна учёба.");
  data.study.data.summary.openDebts = Number(count);
  data.actions = [];
  expect(buildTodayBriefing(data, data.asOf)).toContain(
    `По учёбе: ${label} — согласуйте с преподавателем срок сдачи.`,
  );
});

it("нет действий: спокойная фраза только при всех загруженных источниках", async () => {
  const d = todayFixture();
  const data = await d.overview.execute(d.anna);
  data.actions = [];
  expect(buildTodayBriefing(data, data.asOf)).toContain(
    "Срочных дел сейчас нет.",
  );
  for (const source of ["study", "requests", "notifications"] as const) {
    expect(
      buildTodayBriefing({ ...data, [source]: { ok: false } }, data.asOf),
    ).not.toContain("Срочных дел сейчас нет.");
  }
});

it("сбой главного источника выбирает следующее доступное действие", async () => {
  const d = todayFixture();
  const data = await d.overview.execute(d.timur);
  const action = data.actions[0];
  if (!action) throw new Error("Нужно действие.");
  data.study = { ok: false };
  data.actions = [
    action,
    {
      ...action,
      id: "notification:test",
      section: "notifications",
      message: { code: "notification", title: "Деканат ответил", body: "" },
    },
  ];
  const phrases = buildTodayBriefing(data, data.asOf);
  expect(phrases).toContain("Главное: Деканат ответил.");
  expect(phrases.join(" ")).not.toContain("есть долг");
});

it("несколько изменений не раздувают сводку и считаются без двойного переноса", async () => {
  const d = todayFixture();
  const data = await d.overview.execute(d.anna);
  if (!data.schedule.ok) throw new Error("Нужно расписание.");
  const lesson = data.schedule.data.changes[0];
  const change = lesson?.changes[0];
  if (!lesson || !change) throw new Error("Нужно изменение.");
  lesson.changes.push(
    ...["extra-1", "extra-2"].map((id) => ({ ...change, id })),
  );
  const phrases = buildTodayBriefing(data, data.asOf);
  expect(
    phrases.filter((phrase) => phrase.startsWith("Изменение:")),
  ).toHaveLength(1);
  expect(phrases[1]).toContain("ещё 2 изменения в расписании");
  expect(phrases.length).toBeLessThanOrEqual(5);
});

it.each(["schedule", "study", "requests", "notifications"] as const)(
  "сбой %s пропускает его факты и действия, остальные остаются",
  async (source) => {
    const d = todayFixture();
    const data = await d.overview.execute(d.anna);
    const marker = `Факт источника ${source}`;
    data.actions = [
      {
        id: "test",
        section:
          source === "schedule"
            ? "notifications"
            : source === "study"
              ? "grades"
              : source,
        message: { code: "notification", title: marker, body: "" },
        href: "/today",
        label: "openNotifications",
        urgency: "today",
        dueAt: null,
      },
    ];
    const result = buildTodayBriefing(
      { ...data, [source]: { ok: false } },
      data.asOf,
    );
    if (source !== "schedule") expect(result.join(" ")).not.toContain(marker);
    else
      expect(result.join(" ")).not.toContain("История международных отношений");
    expect(result.join(" ")).not.toContain("Срочных дел сейчас нет");
    expect(result.length).toBeGreaterThan(0);
  },
);

it("нет данных: никаких придуманных фактов, безопасное пустое состояние с подсказкой", async () => {
  const d = todayFixture();
  const data = {
    ...(await d.overview.execute(d.anna)),
    schedule: { ok: false } as const,
    study: { ok: false } as const,
    requests: { ok: false } as const,
    notifications: { ok: false } as const,
  };
  expect(buildTodayBriefing(data, data.asOf)).toEqual([]);
  const html = renderToStaticMarkup(createElement(TodayBriefingCard, { data }));
  expect(html).toContain("Повторите загрузку недоступных разделов ниже");
  expect(html).not.toContain("Послушать");
  expect(html).toContain("Спросить подробнее");
  expect(html).toContain('role="status"');
});

it("действие показывает фактический срок по Москве, заявка дополняет короткую сводку", async () => {
  const d = todayFixture();
  const data = await d.overview.execute(d.anna);
  data.schedule = { ok: false };
  data.study = { ok: false };
  data.actions = [
    {
      id: "clarify",
      section: "requests",
      message: { code: "notification", title: "Уточните данные", body: "" },
      href: "/requests/clarify",
      label: "openRequest",
      urgency: "today",
      dueAt: "2026-11-04T21:30:00.000Z",
    },
  ];
  data.requests = {
    ok: true,
    data: {
      total: 2,
      active: [
        {
          id: "other",
          title: "Вопрос в деканат",
          status: "in_progress",
          dueAt: null,
          sla: null,
        },
      ],
    },
  };
  expect(buildTodayBriefing(data, data.asOf)).toEqual([
    "Главное: Уточните данные; срок — 5 ноября в 00:30 МСК.",
    "Заявка «Вопрос в деканат» — в работе.",
  ]);
});

it.each(["room", "cancelled", "replaced"] as const)(
  "изменение %s не превращается в перенос",
  async (kind) => {
    const d = todayFixture();
    const data = await d.overview.execute(d.anna);
    if (!data.schedule.ok) throw new Error("Нужно расписание.");
    for (const lesson of data.schedule.data.changes)
      for (const change of lesson.changes) change.kind = kind;
    const result = buildTodayBriefing(data, data.asOf).join(" ");
    expect(result).not.toContain("перенесено");
    expect(result).toContain(
      {
        room: "теперь в аудитории 312",
        cancelled: "отменено",
        replaced: "ведёт Светлана Рощина",
      }[kind],
    );
  },
);
