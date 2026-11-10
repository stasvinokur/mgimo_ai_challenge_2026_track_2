import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { GetMyGrades } from "@/application/grades/get-my-grades";
import { CourseCard, CourseDetails } from "@/ui/grades/course-card";
import { GradesView } from "@/ui/grades/grades-view";
import { notificationActionLabel } from "@/ui/notifications/action-label";
import { AppShell } from "@/ui/shell/app-shell";
import { navigation } from "@/ui/shell/navigation";
import { notificationFixtures } from "../../scripts/fixtures/notifications";
import { fixtureContext } from "../../scripts/fixtures/shared";
import { FakeClock } from "../fakes/clock";
import { SequentialIdGenerator } from "../fakes/id-generator";
import { todayFixture } from "../fakes/today";

vi.mock("next/navigation", () => ({
  usePathname: () => "/today",
  useRouter: () => ({ refresh: vi.fn() }),
}));

it.each([
  ["/schedule", "Открыть расписание"],
  ["/schedule?view=week#day", "Открыть расписание"],
  ["/grades", "Открыть успеваемость"],
  ["/grades/course#work", "Открыть успеваемость"],
  ["/requests/id", "Открыть заявку"],
  ["/requests/id/?mode=view", "Открыть заявку"],
  ["/requests", "Перейти"],
  ["/schedule-other", "Перейти"],
  ["/regulations", "Перейти"],
])("подпись действия %s отражает назначение ссылки", (link, label) =>
  expect(notificationActionLabel(link)).toBe(label),
);

it("сводка Тимура первым текстом говорит о долге и объясняет стипендию", async () => {
  const d = todayFixture();
  const data = await new GetMyGrades(d.repository, d.clock).execute(d.timur);
  const html = renderToStaticMarkup(createElement(GradesView, { data }));
  expect(html).toContain("Есть долг по «Основы маркетинга»: согласуйте");
  expect(html.indexOf("Есть долг по")).toBeLessThan(
    html.indexOf("Средний текущий балл"),
  );
  expect(html).not.toContain("Средний текущий балл достигает вашей цели");
  expect(html).toContain('href="/regulations/scholarship#p-2"');
});

it("светофор в карточке и на странице ведёт к пункту положения", async () => {
  const d = todayFixture();
  const data = await new GetMyGrades(d.repository, d.clock).execute(d.anna);
  const course = data.courses[0];
  if (!course) throw new Error("Нет дисциплины.");
  for (const element of [
    createElement(CourseCard, { course }),
    createElement(CourseDetails, { course, target: 86 }),
  ]) {
    const html = renderToStaticMarkup(element);
    expect(html).toContain('href="/regulations/assessment#p-4"');
    expect(html).toContain("Почему?");
  }
});

it.each(["student", "staff"] as const)(
  "оболочка %s без переключателя ролей; положения доступны, нижних пунктов пять",
  (audience) => {
    const props = { audience, children: "Экран" };
    const html = renderToStaticMarkup(createElement(AppShell, props));
    expect(html).not.toContain("workspace-link");
    expect(html).not.toContain(
      audience === "student" ? 'href="/staff/requests"' : 'href="/today"',
    );
    if (audience === "student") {
      expect(html).toContain('href="/regulations"');
      expect(
        navigation.filter(
          (item) => item.audience === "student" && item.placement === "primary",
        ),
      ).toHaveLength(5);
    } else expect(html).toContain('href="/staff/requests"');
  },
);

it.each(["2026-11-04T09:00:00Z", "2026-11-08T21:30:00Z"])(
  "уведомления без ISO-дат, с разным прошедшим временем при обновлении %s",
  (now) => {
    const clock = new FakeClock(now);
    const ctx = fixtureContext(clock, new SequentialIdGenerator());
    const data = notificationFixtures(ctx);
    expect(
      data.notifications.every((item) => !/\d{4}-\d{2}-\d{2}/.test(item.body)),
    ).toBe(true);
    expect(data.notifications[0]?.body).toMatch(/^Сегодня:/);
    const times = data.notifications.map(
      (item) => item.createdAt?.getTime() ?? Infinity,
    );
    expect(new Set(times).size).toBe(times.length);
    expect(
      times.every(
        (at) =>
          at < clock.now().getTime() &&
          at > clock.now().getTime() - 2 * 3_600_000,
      ),
    ).toBe(true);
    clock.advance(86_400_000);
    const refreshed = notificationFixtures(
      fixtureContext(clock, new SequentialIdGenerator()),
    );
    expect(refreshed.notifications[0]?.body).toMatch(/^Сегодня:/);
    expect(refreshed.notifications[0]?.createdAt?.getTime()).toBe(
      (data.notifications[0]?.createdAt?.getTime() ?? 0) + 86_400_000,
    );
  },
);

it("в воскресенье текст переноса показывает понятную дату понедельника", () => {
  const ctx = fixtureContext(
    new FakeClock("2026-11-08T09:00:00Z"),
    new SequentialIdGenerator(),
  );
  expect(notificationFixtures(ctx).notifications[0]?.body).toMatch(
    /^9 ноября:/,
  );
});
