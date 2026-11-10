import { expect, it } from "vitest";
import type { GradesRecord } from "@/application/grades/ports";
import { actionPresentation } from "@/ui/today/action-label";
import { scholarshipHeadline } from "@/ui/today/format";
import { todayFixture } from "../fakes/today";

interface Scenario {
  name: string;
  scores: (number | null)[];
  overdue?: boolean;
  empty?: boolean;
  invalid?: boolean;
  multiple?: boolean;
}

const scenarios: Scenario[] = [
  { name: "все баллы на повышенную", scores: [90, 90] },
  { name: "баллы только на академическую", scores: [75, 75] },
  { name: "все работы оценены ниже порога", scores: [50, 50] },
  { name: "академическая ещё достижима", scores: [50, null] },
  { name: "повышенная ещё достижима", scores: [90, null] },
  { name: "остались две работы", scores: [null, null] },
  { name: "нужен план пересдачи", scores: [40, 40] },
  { name: "максимум оставшейся работы не спасает", scores: [0, null] },
  {
    name: "обязательные работы просрочены",
    scores: [null, null],
    overdue: true,
  },
  { name: "дисциплин пока нет", scores: [], empty: true },
  { name: "веса требуют уточнения", scores: [null, null], invalid: true },
  {
    name: "требования нескольких дисциплин",
    scores: [null, null],
    multiple: true,
  },
];

it("русский UI сохраняет исходные прогноз и советы во всех ветках кодового DTO", async () => {
  const d = todayFixture();
  const record = d.records.get(d.ctx.row("student:anna").id);
  const base = record?.courses[0];
  if (!record || !base) throw new Error("Нужна вымышленная дисциплина.");
  const states = new Set<string>();
  const advice = new Set<string>();
  let checked = 0;
  const levels: GradesRecord["scholarship"][] = [
    "none",
    "academic",
    "increased",
  ];

  for (const current of levels) {
    for (const scenario of scenarios) {
      const context = `${current}: ${scenario.name}`;
      record.scholarship = current;
      const works = scenario.scores.map((score, index) => ({
        id: `parity-work-${index}`,
        title: `ДЕМО: работа ${index}`,
        score,
        maxScore: 100,
        weight: scenario.invalid ? 0 : 50,
        isRequired: Boolean(scenario.overdue),
        dueAt: scenario.overdue
          ? "2026-11-01T09:00:00Z"
          : "2026-11-10T09:00:00Z",
      }));
      record.courses = scenario.empty ? [] : [{ ...base, works }];
      if (scenario.multiple) {
        record.courses.push({
          ...base,
          id: "parity-extra-course",
          title: "ДЕМО: вторая дисциплина",
          works: works.map((work) => ({ ...work, id: `${work.id}-extra` })),
        });
      }

      const grades = await d.sources.grades(d.anna);
      const overview = await d.overview.execute(d.anna);
      if (!overview.study.ok) throw new Error("Нужен источник успеваемости.");
      expect(
        scholarshipHeadline(overview.study.data.scholarship, "ru"),
        context,
      ).toBe(grades.scholarship.outlook.headline);
      states.add(overview.study.data.scholarship.state);

      for (const action of overview.actions) {
        if (action.message.code !== "course") continue;
        const course = grades.courses.find(
          (item) => action.id === `course:${item.id}`,
        );
        if (!course) throw new Error("Нужна дисциплина учебного действия.");
        const presentation = actionPresentation(action, "ru");
        expect(presentation.description, context).toBe(course.light.action);
        expect(presentation.title, context).toBe(
          `${course.title} — ${course.light.label.toLocaleLowerCase("ru-RU")}`,
        );
        advice.add(action.message.advice);
      }
      checked += 1;
    }
  }

  expect(checked).toBe(36);
  expect([...states].sort()).toEqual([
    "at-risk",
    "clarification",
    "debt",
    "eligible",
    "retained",
    "unreachable",
  ]);
  expect([...advice].sort()).toEqual([
    "calculate",
    "improve",
    "resit",
    "submitRequired",
  ]);
});
