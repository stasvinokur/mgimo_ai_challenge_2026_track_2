import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { GetToday, GetWeek } from "@/application/schedule/get-schedule";
import { ScheduleView } from "@/ui/schedule/schedule-view";
import { FakeClock } from "../fakes/clock";
import {
  anna,
  change,
  FakeScheduleRepository,
  scheduleData,
} from "../fakes/schedule";

it.each(["today", "week"] as const)(
  "заголовок дня в режиме %s содержит заглавную только в начале, без CSS-преобразования",
  async (view) => {
    const repository = new FakeScheduleRepository();
    const clock = new FakeClock("2026-11-04T09:00:00Z");
    const html = renderToStaticMarkup(
      createElement(ScheduleView, {
        week: await new GetWeek(repository, clock).execute(anna),
        today: await new GetToday(repository, clock).execute(anna),
        view,
      }),
    );
    expect(html).toContain("<h2>Среда, 4 ноября · сегодня</h2>");
    expect(html).not.toContain("capitalize");
  },
);

it.each([
  ["room", "Смена аудитории", "Ауд. 405 → 312"],
  ["replaced", "Замена преподавателя", "Светлана Рощина → Нина Береговая"],
  ["cancelled", "Отмена занятия", "занятие отменено"],
  ["moved", "Перенос", "Перенесено с"],
] as const)(
  "экран объясняет %s словами, диффом и причиной",
  async (kind, badge, diff) => {
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
    const week = await new GetWeek(repository, clock).execute(anna);
    const today = await new GetToday(repository, clock).execute(anna);
    const html = renderToStaticMarkup(
      createElement(ScheduleView, { week, today, view: "today" }),
    );
    expect(html).toContain(badge);
    expect(html).toContain(diff);
    expect(html).toContain("Причина: Учебная причина.");
    if (kind === "moved") {
      expect(html).toContain("Перенесено на");
      expect(html).toContain("<s>");
      expect(html).toContain("09:00");
      expect(html).toContain("13:00");
    }
    if (kind === "cancelled") expect(html).toContain("Ближайший учебный день");
  },
);

it("текущая и следующая пара подписаны; пустой день даёт понятный переход", async () => {
  const repository = new FakeScheduleRepository();
  const clock = new FakeClock("2026-11-02T09:59:00Z");
  async function render() {
    return renderToStaticMarkup(
      createElement(ScheduleView, {
        week: await new GetWeek(repository, clock).execute(anna),
        today: await new GetToday(repository, clock).execute(anna),
        view: "today",
      }),
    );
  }
  expect(await render()).toContain("Через 1 мин");
  clock.advance(60_000);
  expect(await render()).toContain("Идёт сейчас");
  clock.set("2026-11-01T12:00:00Z");
  const empty = await render();
  expect(empty).toContain("Занятий нет");
  expect(empty).toContain("К ближайшему учебному дню");
});
