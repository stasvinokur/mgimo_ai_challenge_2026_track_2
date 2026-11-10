import { describe, expect, it } from "vitest";
import { calculateWhatIf } from "@/application/grades/calculation";
import { GetCourseActions } from "@/application/grades/get-course-actions";
import { GetMyGrades } from "@/application/grades/get-my-grades";
import { calculateScholarship } from "@/application/grades/scholarship";
import { courseActions } from "@/domain/grades/course-actions";
import type { GradeWork } from "@/domain/grades/grading-policy";
import { whatIf } from "@/domain/grades/what-if";
import { gradeLabel } from "@/ui/grades/format";
import { gradesFixture } from "../fakes/grades";

function work(id: string, overrides: Partial<GradeWork> = {}): GradeWork {
  return {
    id,
    title: `Работа ${id}`,
    weight: 50,
    maxScore: 100,
    score: null,
    dueAt: "2026-11-07T09:00:00Z",
    isRequired: true,
    ...overrides,
  };
}

describe("Исходы несданной работы", () => {
  it("сдача достигает цели, недоступной при пропуске этой работы", () => {
    const works = [
      work("done", { weight: 90, score: 80 }),
      work("pending", { weight: 10 }),
    ];
    const forecast = calculateWhatIf(works, { pending: 80 }, 80);
    expect(forecast.remaining[0]?.outcomes).toEqual({
      currentTotal: 72,
      target: 80,
      maxScore: 100,
      submitted: {
        score: 80,
        total: 80,
        grade: { code: "good", credit: true },
        reachesTarget: true,
      },
      skipped: {
        total: 72,
        grade: { code: "good", credit: true },
        reachesTarget: false,
      },
    });
    expect(forecast.reachesTarget).toBe(true);
  });

  it("уже набранная цель сохраняется в обеих ветках, настоящие итоги различаются", () => {
    const forecast = calculateWhatIf(
      [
        work("done", { weight: 90, score: 100 }),
        work("pending", { weight: 10, isRequired: false }),
      ],
      { pending: 50 },
      86,
    );
    expect(forecast.remaining[0]).toMatchObject({
      minimum: 0,
      outcomes: {
        currentTotal: 90,
        submitted: {
          total: 95,
          grade: { code: "excellent" },
          reachesTarget: true,
        },
        skipped: {
          total: 90,
          grade: { code: "excellent" },
          reachesTarget: true,
        },
      },
    });
  });

  it("недостижимая цель не обещается даже при максимуме", () => {
    const forecast = calculateWhatIf(
      [
        work("done", { weight: 90, score: 60 }),
        work("pending", { weight: 10 }),
      ],
      { pending: 100 },
      86,
    );
    expect(forecast.reachesTarget).toBe(false);
    expect(forecast.remaining[0]).toMatchObject({
      minimum: null,
      outcomes: {
        submitted: {
          total: 64,
          grade: { code: "satisfactory", credit: true },
          reachesTarget: false,
        },
        skipped: {
          total: 54,
          grade: { code: "unsatisfactory", credit: false },
          reachesTarget: false,
        },
      },
    });
  });

  it("77/99/68 с весами 45/45/10 дают точные 86 и оценку «отлично»", () => {
    const forecast = calculateWhatIf(
      [
        work("first", { weight: 45, score: 77 }),
        work("second", { weight: 45, score: 99 }),
        work("pending", { weight: 10 }),
      ],
      { pending: 68 },
      86,
    );
    expect(forecast.reachesTarget).toBe(true);
    expect(forecast.remaining[0]?.outcomes).toMatchObject({
      currentTotal: 79.2,
      submitted: {
        score: 68,
        total: 86,
        grade: { code: "excellent", credit: true },
        reachesTarget: true,
      },
      skipped: {
        total: 79.2,
        grade: { code: "good", credit: true },
        reachesTarget: false,
      },
    });
  });

  it("округлившийся до 86 числовой DTO не меняет точную оценку и достижение цели", () => {
    const forecast = calculateWhatIf(
      [
        work("done", { weight: 85, maxScore: 1, score: 1 }),
        work("pending", { weight: 1, maxScore: 1e17 }),
        work("other", { weight: 14, score: 0 }),
      ],
      { pending: 1e17 - 16 },
      86,
    );
    expect(forecast.total).toBe(86);
    expect(forecast.reachesTarget).toBe(false);
    expect(forecast.remaining[0]?.outcomes).toMatchObject({
      submitted: {
        total: 86,
        grade: { code: "good", credit: true },
        reachesTarget: false,
      },
      skipped: {
        total: 85,
        grade: { code: "good", credit: true },
        reachesTarget: false,
      },
    });
  });

  it("граница стипендии Анны 76/77 совпадает с оценкой и целью каждой ветки", async () => {
    const d = gradesFixture();
    const data = await new GetMyGrades(d.repository, d.clock).executeMessages(
      d.anna,
    );
    const course = data.courses.find(
      (item) => item.title === "Иностранный язык",
    );
    const pending = course?.works.find((item) => item.score === null);
    if (!course || !pending) throw new Error("Нужен сценарий Анны.");
    const before = structuredClone(data);
    for (const [score, grade, reachesTarget, level] of [
      [76, "good", false, "academic"],
      [77, "excellent", true, "increased"],
    ] as const) {
      const predictions = { [pending.id]: score };
      const forecast = calculateWhatIf(
        course.works,
        predictions,
        data.targetScore,
      );
      const outcomes = forecast.remaining[0]?.outcomes;
      expect(outcomes?.submitted).toMatchObject({
        score,
        grade: { code: grade },
        reachesTarget,
      });
      expect(outcomes?.skipped).toMatchObject({
        grade: { code: "good" },
        reachesTarget: false,
      });
      expect(
        calculateScholarship(data.courses, "increased", {
          courseId: course.id,
          predictions,
          skipped: {},
        }).level,
      ).toBe(level);
      expect(
        calculateScholarship(data.courses, "increased", {
          courseId: course.id,
          predictions: { [pending.id]: 0 },
          skipped: { [pending.id]: true },
        }).outlook.state,
      ).toBe("debt");
    }
    expect(data).toEqual(before);
  });

  it("округлённый большой minimum не подменяет точную проверку цели", () => {
    const forecast = calculateWhatIf(
      [
        work("done", { weight: 90, maxScore: 101, score: 95.4 }),
        work("pending", { weight: 10, maxScore: 1e17 }),
      ],
      { pending: 9900990099009900 },
      86,
    );
    expect(forecast.remaining[0]?.minimum).toBe(9900990099009900);
    expect(forecast.reachesTarget).toBe(false);
    expect(forecast.remaining[0]?.outcomes.submitted.reachesTarget).toBe(false);
  });

  it("обе ветки сохраняют баллы других несданных работ и исходный доменный контракт", () => {
    const works = [
      work("done", { weight: 50, score: 60 }),
      work("a", { weight: 25 }),
      work("b", { weight: 25 }),
    ];
    const predictions = { a: 80, b: 80 };
    const beforeWorks = structuredClone(works);
    const beforePredictions = structuredClone(predictions);
    const domain = whatIf(works, predictions, 70);
    const result = calculateWhatIf(works, predictions, 70);
    const { reachesTarget, remaining, grade, ...existing } = result;
    const { grade: domainGrade, ...domainValues } = domain;
    expect(reachesTarget).toBe(true);
    expect({
      ...existing,
      remaining: remaining.map(({ outcomes: _outcomes, ...branch }) => branch),
    }).toEqual(domainValues);
    expect(gradeLabel(grade)).toBe(domainGrade.label);
    expect(grade.credit).toBe(domainGrade.credit);
    for (const branch of remaining) {
      expect(branch.outcomes.currentTotal).toBe(30);
      expect(branch.outcomes.submitted).toMatchObject({
        total: 70,
        grade: { code: "good" },
        reachesTarget: true,
      });
      expect(branch.outcomes.skipped).toMatchObject({
        total: 50,
        grade: { code: "unsatisfactory" },
        reachesTarget: false,
      });
    }
    expect(works).toEqual(beforeWorks);
    expect(predictions).toEqual(beforePredictions);
  });
});

it.each(["anna", "timur"] as const)(
  "варианты %s дополняют исходный план без изменения его чисел",
  async (name) => {
    const d = gradesFixture();
    const actor = d[name];
    if (actor.kind !== "student") throw new Error("Нужен студент.");
    const record = d.records.get(actor.studentId);
    const course = record?.courses[0];
    if (!record || !course) throw new Error("Нужна дисциплина.");
    const before = structuredClone(record);
    const original = courseActions(
      course,
      record.targetScore,
      d.clock.now().toISOString(),
    );
    const plan = await new GetCourseActions(d.repository, d.clock).execute(
      actor,
      { courseId: course.id },
    );
    if (!plan || !original) throw new Error("Нужен план действий.");
    expect(
      plan.options.map(({ workId, score, total, reachesTarget, dueAt }) => ({
        workId,
        score,
        total,
        reachesTarget,
        dueAt,
      })),
    ).toEqual(
      original.options.map(
        ({ workId, score, total, reachesTarget, dueAt }) => ({
          workId,
          score,
          total,
          reachesTarget,
          dueAt,
        }),
      ),
    );
    for (const option of plan.options) {
      if (option.score === null || option.workId === null)
        throw new Error("Нужна несданная работа.");
      const domain = whatIf(
        course.works,
        { [option.workId]: option.score },
        record.targetScore,
      );
      const branch = domain.remaining.find((item) => item.id === option.workId);
      expect(option.outcomes).toMatchObject({
        submitted: {
          score: option.score,
          total: option.total,
          grade: { credit: domain.grade.credit },
          reachesTarget: option.reachesTarget,
        },
        skipped: { total: branch?.skippedTotal },
      });
      if (!option.outcomes) throw new Error("Нужна развилка.");
      expect(gradeLabel(option.outcomes.submitted.grade)).toBe(
        domain.grade.label,
      );
    }
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
    expect(record).toEqual(before);
  },
);

it("вариант при всех оценённых работах не выдумывает развилку сдачи", async () => {
  const d = gradesFixture();
  if (d.anna.kind !== "student") throw new Error("Нужен студент.");
  const course = d.records.get(d.anna.studentId)?.courses[0];
  if (!course) throw new Error("Нужна дисциплина.");
  for (const item of course.works) item.score = 10;
  const plan = await new GetCourseActions(d.repository, d.clock).execute(
    d.anna,
    { courseId: course.id },
  );
  expect(plan?.options).toHaveLength(1);
  expect(plan?.options[0]).toMatchObject({
    workId: null,
    score: null,
    outcomes: null,
  });
});
