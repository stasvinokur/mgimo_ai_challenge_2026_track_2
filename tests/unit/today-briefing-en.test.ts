import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  briefingMessages,
  pickupTodayMessages,
} from "@/ui/i18n/dictionaries/today";
import { LanguageProvider } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { PickupToday } from "@/ui/requests/pickup-today";
import { buildTodayBriefing } from "@/ui/today/briefing";
import { TodayBriefingCard } from "@/ui/today/briefing-card";
import { todayFixture } from "../fakes/today";

it("сводка English сохраняет факты Анны, числа и русский текст БД", async () => {
  const d = todayFixture();
  const data = await d.overview.execute(d.anna);
  const before = structuredClone(data);
  const phrases = buildTodayBriefing(data, data.asOf, "en");
  expect(phrases).toHaveLength(4);
  expect(phrases[0]).toBe(
    "In 1 hour — “История международных отношений”, room 312.",
  );
  expect(phrases[1]).toBe(
    "Schedule change: “История международных отношений” has moved to 13:00 MSK, room 312.",
  );
  expect(phrases[2]).toMatch(/^Priority: /);
  expect(phrases[3]).toContain("77 out of 100");
  expect(phrases[3]).toContain("Итоговый тест");
  expect(phrases[3]).toContain("Иностранный язык");
  expect(data).toEqual(before);
  expect(buildTodayBriefing(data, data.asOf, "en")).toEqual(phrases);
});

it("Тимур: английское учебное действие и долг озвучиваются один раз", async () => {
  const d = todayFixture();
  const data = await d.overview.execute(d.timur);
  const phrases = buildTodayBriefing(data, data.asOf, "en");
  expect(phrases.length).toBeGreaterThanOrEqual(3);
  expect(phrases.join(" ")).toContain("Основы маркетинга");
  expect(phrases.join(" ")).not.toContain("Иностранный язык");
  expect(phrases.join(" ").match(/overdue required work/g)).toHaveLength(1);
});

it.each(["moved", "room", "cancelled", "replaced"] as const)(
  "English: изменение %s строится из кода, дата всегда московская",
  async (kind) => {
    const d = todayFixture();
    const data = await d.overview.execute(d.anna);
    if (!data.schedule.ok) throw new Error("Нужен источник расписания.");
    for (const lesson of data.schedule.data.changes)
      for (const change of lesson.changes) {
        change.kind = kind;
        change.after.startsAt = "2026-11-04T22:30:00.000Z";
      }
    const text = buildTodayBriefing(data, data.asOf, "en").join(" ");
    expect(text).toContain(
      {
        moved: "has moved to 5 November, 01:30 MSK, room 312",
        room: "is now in room 312",
        cancelled: "has been cancelled",
        replaced: "will be taught by Светлана Рощина",
      }[kind],
    );
  },
);

it("пустая English сводка не придумывает факты и предлагает повторить загрузку", async () => {
  const d = todayFixture();
  const data = {
    ...(await d.overview.execute(d.anna)),
    schedule: { ok: false } as const,
    study: { ok: false } as const,
    requests: { ok: false } as const,
    notifications: { ok: false } as const,
  };
  expect(buildTodayBriefing(data, data.asOf, "en")).toEqual([]);
  const props = {
    language: "en" as const,
    children: createElement(TodayBriefingCard, { data }),
  };
  const html = renderToStaticMarkup(createElement(LanguageProvider, props));
  expect(html).toContain("There is no data for the briefing yet");
  expect(html).toContain("Ask for details");
  expect(html).not.toContain(">Listen</button>");
});

it("English: Listen до проверки голосов отключена и связана с пояснением", async () => {
  const d = todayFixture();
  const data = await d.overview.execute(d.anna);
  const props = {
    language: "en" as const,
    children: createElement(TodayBriefingCard, { data }),
  };
  const html = renderToStaticMarkup(createElement(LanguageProvider, props));
  expect(html).toContain('data-briefing-ready="false"');
  const listen = html.match(/<button[^>]*>Listen<\/button>/)?.[0];
  expect(listen).toContain('disabled=""');
  const id = listen?.match(/aria-describedby="([^"]+)"/)?.[1];
  expect(id).toBeTruthy();
  expect(html).toContain(`id="${id}"`);
  expect(html).toContain(t("en", briefingMessages, "unsupported"));
  expect(listen).not.toContain("aria-label");
});

it("строка талона English: Moscow time, дата и вызов; название окна из БД сохранено", () => {
  const booking = {
    id: "own",
    requestId: "request",
    ticketNo: "Т-123",
    windowId: "window",
    windowTitle: "Окно выдачи 3",
    slotStartsAt: "2026-11-04T22:30:00.000Z",
    status: "called" as const,
    canCancel: false,
  };
  const props = {
    language: "en" as const,
    children: createElement(PickupToday, { bookings: [booking] }),
  };
  const html = renderToStaticMarkup(createElement(LanguageProvider, props));
  expect(html).toContain("Thu 5 November");
  expect(html).toContain("01:30");
  expect(html).toContain("MSK");
  expect(html).toContain("Please come to Окно выдачи 3");
  expect(html).toContain("/requests/request");
  expect(html).toContain(t("en", pickupTodayMessages, "tickets"));
});

it("параметры русских и английских сообщений сводки совпадают", () => {
  for (const dictionary of [briefingMessages, pickupTodayMessages])
    for (const message of Object.values(dictionary)) {
      const params = (value: string) =>
        [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      expect(params(message.en)).toEqual(params(message.ru));
    }
});
