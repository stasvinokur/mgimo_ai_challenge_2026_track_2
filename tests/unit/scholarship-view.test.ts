import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { GetMyGrades } from "../../src/application/grades/get-my-grades";
import { calculateScholarship } from "../../src/application/grades/scholarship";
import { GradesView } from "../../src/ui/grades/grades-view";
import { ScholarshipCard } from "../../src/ui/grades/scholarship-forecast";
import { WhatIf } from "../../src/ui/grades/what-if";
import { TodayView } from "../../src/ui/today/today-view";
import { todayFixture } from "../fakes/today";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

it("сервер и начальный клиентский сценарий показывают все дисциплины и ссылку на правило", async () => {
  const d = todayFixture();
  const data = await new GetMyGrades(d.repository, d.clock).executeMessages(
    d.anna,
  );
  const course = data.courses.find((item) => item.title === "Иностранный язык");
  if (course?.calculationStatus !== "ready")
    throw new Error("Нет вымышленной дисциплины.");
  const summary = renderToStaticMarkup(
    createElement(ScholarshipCard, { forecast: data.scholarship }),
  );
  expect(summary).toContain(
    "Повышенная стипендия под угрозой: нужно не меньше 77 из 100",
  );
  expect(summary).toContain("не меньше 77 из 100");
  expect(summary).toContain('href="/regulations/scholarship#p-2"');
  const simulation = renderToStaticMarkup(
    createElement(WhatIf, {
      course,
      target: data.targetScore,
      semester: data,
    }),
  );
  expect(simulation).toContain("Повышенная стипендия сохраняется.");
  const today = renderToStaticMarkup(
    createElement(TodayView, { data: await d.overview.execute(d.anna) }),
  );
  expect(today).toContain("Повышенная стипендия под угрозой");
  expect(today).toContain('href="/grades"');
});

it("вывод идёт первым, правило доступно один раз, объяснение свёрнуто и дисциплина открывается кнопкой", async () => {
  const d = todayFixture();
  const data = await new GetMyGrades(d.repository, d.clock).executeMessages(
    d.anna,
  );
  const html = renderToStaticMarkup(createElement(GradesView, { data }));
  expect(html).toMatch(
    /data-testid="scholarship-forecast"><p[^>]*>Повышенная стипендия под угрозой/,
  );
  expect(html.match(/Правила стипендии<\/span>/g)).toHaveLength(1);
  const details = html.match(
    /<details[^>]*aria-labelledby="[^"]*-calculation"[^>]*>[\s\S]*?<\/details>/,
  )?.[0];
  expect(details).toContain(
    "Оставшиеся работы без выбранного балла считаются как 0",
  );
  expect(details).not.toMatch(/<details[^>]*\sopen[\s=>]/);
  const scholarship = html.slice(
    html.indexOf('data-testid="scholarship-forecast"'),
    html.indexOf("Как у меня дела"),
  );
  const links = [...scholarship.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map(
    (match) => match[1]?.replace(/<[^>]*>/g, ""),
  );
  expect(links).toEqual([
    "Открыть дисциплину «Иностранный язык»",
    "Почему? Правила стипендии",
  ]);
});

it("пустой семестр даёт подсказку об уточнении, недостижимый уровень — честное объяснение", async () => {
  const empty = renderToStaticMarkup(
    createElement(ScholarshipCard, {
      forecast: calculateScholarship([], "increased"),
    }),
  );
  expect(empty).toContain("Прогноз стипендии требует уточнения");
  expect(empty).toContain("Уточните данные у преподавателя");
  const d = todayFixture();
  const data = await new GetMyGrades(d.repository, d.clock).executeMessages(
    d.anna,
  );
  const courses = data.courses.map((course) => ({
    ...course,
    works: course.works.map((work) => ({
      ...work,
      score: work.maxScore * 0.6,
    })),
  }));
  const html = renderToStaticMarkup(
    createElement(ScholarshipCard, {
      forecast: calculateScholarship(courses, "increased"),
    }),
  );
  expect(html).toContain("недостижима в этом семестре");
  expect(html).toContain("удовлетворительно");
});
