import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { GetToday, GetWeek } from "@/application/schedule/get-schedule";
import { scheduleMessages } from "@/ui/i18n/dictionaries/schedule";
import { LanguageProvider } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { CalendarSubscription } from "@/ui/schedule/calendar-subscription";
import { ScheduleView } from "@/ui/schedule/schedule-view";
import { FakeClock } from "../fakes/clock";
import {
  anna,
  change,
  FakeScheduleRepository,
  scheduleData,
} from "../fakes/schedule";

it.each(["today", "week"] as const)(
  "English %s: московские даты, перенос и данные без перевода",
  async (view) => {
    const repository = new FakeScheduleRepository();
    const clock = new FakeClock("2026-11-02T09:59:00Z");
    const html = renderToStaticMarkup(
      createElement(ScheduleView, {
        language: "en",
        week: await new GetWeek(repository, clock).execute(anna),
        today: await new GetToday(repository, clock).execute(anna),
        view,
      }),
    );
    expect(html).toContain("Monday 2 November · today");
    expect(html).toContain("Moscow time");
    expect(html).toContain("Rescheduled to");
    expect(html).toContain("Rescheduled from");
    expect(html).toContain("09:00–10:30");
    expect(html).toContain("13:00–14:30");
    expect(html).toContain("История международных отношений");
    expect(html).toContain("Светлана Рощина");
    expect(html).toContain("405");
    expect(html).toContain("312");
    expect(html).toContain("Reason: Учебная встреча перенесена.");
    expect(html).not.toContain("Перенесено");
    expect(html).toContain("[overflow-wrap:normal]");
  },
);

it.each([
  ["room", "Room changed", "Room 405 → 312"],
  ["replaced", "Teacher changed", "Светлана Рощина → Нина Береговая"],
  ["cancelled", "Class cancelled", "class cancelled"],
] as const)(
  "English: %s переводится, причина остаётся из БД",
  async (kind, badge, detail) => {
    const repository = new FakeScheduleRepository();
    repository.records.set(
      "anna",
      scheduleData({
        changes: [
          change({
            kind,
            reason: "Учебная причина.",
            newTeacher: kind === "replaced" ? "Нина Береговая" : null,
          }),
        ],
      }),
    );
    const clock = new FakeClock("2026-11-02T05:00:00Z");
    const html = renderToStaticMarkup(
      createElement(ScheduleView, {
        language: "en",
        week: await new GetWeek(repository, clock).execute(anna),
        today: await new GetToday(repository, clock).execute(anna),
        view: "today",
      }),
    );
    expect(html).toContain(badge);
    expect(html).toContain(detail);
    expect(html).toContain("Reason: Учебная причина.");
  },
);

it("English: ближайший день считается по Москве на границе UTC-даты", async () => {
  const repository = new FakeScheduleRepository();
  const clock = new FakeClock("2026-11-01T21:05:00Z");
  const today = await new GetToday(repository, clock).execute(anna);
  const week = await new GetWeek(repository, clock).execute(anna);
  const html = renderToStaticMarkup(
    createElement(ScheduleView, { language: "en", week, today, view: "today" }),
  );
  expect(html).toContain("Monday 2 November · today");
  expect(html).toContain("Lecture");
  expect(html).not.toContain("Sunday 1 November");
  clock.set("2026-11-01T12:00:00Z");
  const empty = renderToStaticMarkup(
    createElement(ScheduleView, {
      language: "en",
      week: await new GetWeek(repository, clock).execute(anna),
      today: await new GetToday(repository, clock).execute(anna),
      view: "today",
    }),
  );
  expect(empty).toContain("No classes");
  expect(empty).toContain("Your next study day is Monday 2 November.");
  expect(empty).toContain("Go to next study day");
});

it("English: подписка до гидратации имеет переведённый текст и отключённую кнопку", () => {
  const props = {
    language: "en" as const,
    children: createElement(CalendarSubscription, { action: vi.fn() }),
  };
  const html = renderToStaticMarkup(createElement(LanguageProvider, props));
  expect(html).toContain("Personal calendar");
  expect(html).toContain("Get a new link");
  expect(html).toContain("keep it private");
  expect(html).toContain("deactivate the previous one");
  expect(html).toContain('data-calendar-ready="false"');
  expect(html).toContain('disabled=""');
  expect(html).toContain("whitespace-normal");
});

it("словарь расписания содержит обе локали и одинаковые параметры каждого сообщения", () => {
  for (const entry of Object.values(scheduleMessages)) {
    expect(entry.ru.trim()).not.toBe("");
    expect(entry.en.trim()).not.toBe("");
    expect(
      [...entry.ru.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort(),
    ).toEqual(
      [...entry.en.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort(),
    );
  }
  expect(t("en", scheduleMessages, "inMinutes", { minutes: "1" })).toBe(
    "In 1 min",
  );
});
