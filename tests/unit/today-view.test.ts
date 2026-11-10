import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { actionPresentation } from "@/ui/today/action-label";
import { Countdown } from "@/ui/today/countdown";
import { TodayView } from "@/ui/today/today-view";
import { todayFixture } from "../fakes/today";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

it("экран Анны показывает три вопроса, полный дифф и прямые ссылки", async () => {
  const d = todayFixture();
  const html = renderToStaticMarkup(
    createElement(TodayView, { data: await d.overview.execute(d.anna) }),
  );
  for (const text of [
    "Сейчас",
    "Требует действия",
    "Что дальше",
    "Было:",
    "Стало:",
    "09:00",
    "13:00",
    "Иностранный язык — на грани",
    "Справка об обучении — готова",
    "5 предметов в норме, 1 требует внимания",
    "До сессии 14 дн.",
  ])
    expect(html).toContain(text);
  expect(html).toContain('href="/requests/ready"');
  expect(html).toContain("Через 1 ч");
  expect(html).toMatch(/<s>[^<]*09:00[^<]*405<\/s>/);
  expect(html).toMatch(
    /→ <span class="sr-only">Стало: <\/span><strong>[^<]*13:00[^<]*312/,
  );
});

it("Тимур видит долг и приглашение обратиться, когда понадобится помощь", async () => {
  const d = todayFixture();
  const html = renderToStaticMarkup(
    createElement(TodayView, { data: await d.overview.execute(d.timur) }),
  );
  expect(html).toContain("Основы маркетинга — есть долг");
  expect(html).toContain("Заявок пока нет");
  expect(html).toContain("справка или помощь деканата");
});

it("строки алертов учёбы ведут к вариантам и передают workId; остальные действия сохраняются", async () => {
  const d = todayFixture();
  const data = await d.overview.execute(d.timur);
  const html = renderToStaticMarkup(createElement(TodayView, { data }));
  for (const item of data.actions) {
    if (item.section === "grades") {
      const suffix = item.id.startsWith("work:")
        ? `&amp;workId=${encodeURIComponent(item.id.slice(5))}`
        : "";
      expect(html).toContain(
        `href="${item.href}?actions=1${suffix}#course-actions"`,
      );
      expect(html).toContain(
        `Что можно сделать?<span class="sr-only">: ${actionPresentation(item).title}</span>`,
      );
    } else expect(html).toContain(`href="${item.href}"`);
  }
});

it("идущая пара показывает время, аудиторию и преподавателя", async () => {
  const d = todayFixture();
  d.clock.set("2026-11-04T10:15:00Z");
  const html = renderToStaticMarkup(
    createElement(TodayView, { data: await d.overview.execute(d.anna) }),
  );
  expect(html).toContain("Идёт сейчас");
  expect(html).toContain("13:00");
  expect(html).toContain("312");
  expect(html).toContain("Светлана Рощина");
  expect(html.match(/role="status"/g)).toHaveLength(1);
  expect(html).toContain('data-testid="briefing-status"');
});

it("день без пар даёт переход к ближайшей учебной неделе", async () => {
  const d = todayFixture();
  d.clock.set("2026-11-08T09:00:00Z");
  const html = renderToStaticMarkup(
    createElement(TodayView, { data: await d.overview.execute(d.anna) }),
  );
  expect(html).toContain("Сегодня пар нет");
  expect(html).toContain("11 ноября");
  expect(html).toContain('href="/schedule?view=week&amp;week=2026-W46"');
});

it("сбой источника показывает безопасную ошибку и повтор, без ложного «Всё под контролем»", async () => {
  const d = todayFixture();
  d.failures.add("grades");
  const data = await d.overview.execute(d.anna);
  data.actions = [];
  const html = renderToStaticMarkup(createElement(TodayView, { data }));
  expect(html).toContain("Учёба: не удалось загрузить");
  expect(html).toContain("Повторить");
  expect(html).not.toContain("технические подробности");
  expect(html).not.toContain("Всё под контролем");
  expect(html).toContain("Изменения на сегодня");
});

it("когда все источники доступны и дел нет — всё под контролем", async () => {
  const d = todayFixture();
  const data = await d.overview.execute(d.anna);
  data.actions = [];
  data.more = [];
  const html = renderToStaticMarkup(createElement(TodayView, { data }));
  expect(html).toContain("Всё под контролем");
  expect(html).toContain("Посмотреть расписание");
});

it("серверный отсчёт использует переданное время независимо от часов браузера", () => {
  vi.useFakeTimers();
  vi.setSystemTime("2030-01-01T00:00:00Z");
  try {
    for (const [startsAt, initialNow, label] of [
      ["2026-11-04T10:00:00Z", "2026-11-04T09:59:00Z", "Через 1 мин"],
      ["2026-11-05T06:00:00Z", "2026-11-04T16:25:00Z", "Завтра в 09:00"],
      ["2026-11-11T06:00:00Z", "2026-11-04T16:25:00Z", "11 ноября в 09:00"],
    ] as const) {
      const html = renderToStaticMarkup(
        createElement(Countdown, { startsAt, initialNow }),
      );
      expect(html).toContain(label);
    }
  } finally {
    vi.useRealTimers();
  }
});
