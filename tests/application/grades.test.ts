import { expect, it } from "vitest";
import {
  calculateWhatIf,
  initialPredictions,
} from "../../src/application/grades/calculation";
import {
  GetCourseGrades,
  GetMyGrades,
} from "../../src/application/grades/get-my-grades";
import type { Actor } from "../../src/application/ports/actor";
import {
  ForbiddenError,
  NotFoundError,
} from "../../src/application/shared/errors";
import { gradesFixture } from "../fakes/grades";

it("сводка Анны пригодна для Сегодня: 5 в норме, 1 требует внимания, цель 86", async () => {
  const d = gradesFixture();
  const data = await new GetMyGrades(d.repository, d.clock).executeMessages(
    d.anna,
    {},
  );
  expect(data.courses).toHaveLength(6);
  expect(data.summary).toEqual({
    averageScore: 89.5,
    inGoodShape: 5,
    needsAttention: 1,
    openDebts: 0,
    targetScore: 86,
  });
  expect(
    data.courses
      .filter((course) => course.light.tone === "success")
      .every((course) => course.secured === 90),
  ).toBe(true);
  expect(data.courses[0]?.forecast?.remaining[0]?.minimum).toBe(77);
  expect(d.repository.calls).toEqual([
    { studentId: d.ctx.row("student:anna").id },
  ]);
  expect(JSON.parse(JSON.stringify(data))).toEqual(data);
});

it("Тимур видит один долг и понятную подсказку, просроченность зависит от Clock", async () => {
  const d = gradesFixture();
  const useCase = new GetMyGrades(d.repository, d.clock);
  const data = await useCase.executeMessages(d.timur);
  expect(data.summary.openDebts).toBe(1);
  expect(data.courses[0]?.light).toMatchObject({
    tone: "danger",
    code: "debt",
  });
  expect(data.courses[0]?.light.code).toBe("debt");
  d.clock.advance(5 * 86_400_000);
  expect((await useCase.executeMessages(d.timur)).summary.openDebts).toBe(2);
});

it("свои данные доступны, чужая и отсутствующая дисциплина дают одинаковый NotFound", async () => {
  const d = gradesFixture();
  const useCase = new GetCourseGrades(d.repository, d.clock);
  const annaId = d.ctx.row("course:fmo:0").id;
  const timurId = d.ctx.row("course:imp:0").id;
  const data = await useCase.execute(d.anna, { courseId: annaId });
  expect(data.course.title).toBe("Иностранный язык");
  expect(
    calculateWhatIf(data.course.works, {}, data.targetScore).remaining[0]
      ?.minimum,
  ).toBe(77);
  for (const [actor, courseId] of [
    [d.anna, timurId],
    [d.timur, annaId],
    [d.anna, "00000000-0000-7000-8000-000000ffffee"],
  ] as const) {
    await expect(useCase.execute(actor, { courseId })).rejects.toEqual(
      new NotFoundError(),
    );
    await expect(
      new GetMyGrades(d.repository, d.clock).executeMessages(actor, {
        courseId,
      }),
    ).resolves.toMatchObject({ courses: expect.any(Array) });
  }
});

it.each(["studentId", "userId", "groupId"])(
  "игнорирует %s клиента в списке и не принимает его как параметр детали",
  async (key) => {
    const d = gradesFixture();
    const input = {
      courseId: d.ctx.row("course:fmo:0").id,
      [key]: d.ctx.row("student:timur").id,
    };
    await expect(
      new GetCourseGrades(d.repository, d.clock).execute(d.anna, input),
    ).rejects.toThrow(NotFoundError);
    expect(d.repository.calls).toHaveLength(0);
    const data = await new GetMyGrades(d.repository, d.clock).executeMessages(
      d.anna,
      input,
    );
    expect(data.courses).toHaveLength(6);
    expect(d.repository.calls).toEqual([
      { studentId: d.ctx.row("student:anna").id },
    ]);
  },
);

it("сотруднику запрещены оба сценария до чтения репозитория", async () => {
  const d = gradesFixture();
  const staff: Actor = {
    kind: "staff",
    userId: "staff",
    staffId: "staff",
    facultyIds: [],
  };
  await expect(
    new GetMyGrades(d.repository, d.clock).executeMessages(staff),
  ).rejects.toThrow(ForbiddenError);
  await expect(
    new GetCourseGrades(d.repository, d.clock).execute(staff, {}),
  ).rejects.toThrow(ForbiddenError);
  expect(d.repository.calls).toHaveLength(0);
});

it("пустое состояние, нет оценок и отсутствующий профиль", async () => {
  const d = gradesFixture();
  const useCase = new GetMyGrades(d.repository, d.clock);
  const studentId = d.ctx.row("student:anna").id;
  const record = d.records.get(studentId);
  if (!record) throw new Error("Нет записи.");
  for (const course of record.courses)
    for (const work of course.works) work.score = null;
  expect(
    (await useCase.executeMessages(d.anna)).summary.averageScore,
  ).toBeNull();
  record.courses = [];
  expect(await useCase.executeMessages(d.anna)).toMatchObject({
    courses: [],
    summary: { averageScore: null, inGoodShape: 0, needsAttention: 0 },
  });
  d.records.clear();
  await expect(useCase.executeMessages(d.anna)).rejects.toThrow(NotFoundError);
});

it.each(["no-works", "score-over-max", "weights"])(
  "плохая дисциплина %s не мешает остальным",
  async (issue) => {
    const d = gradesFixture();
    const record = d.records.get(d.ctx.row("student:anna").id);
    const course = record?.courses[0];
    if (!course) throw new Error("Нет дисциплины.");
    if (issue === "no-works") course.works = [];
    else if (course.works[0]) {
      if (issue === "score-over-max")
        course.works[0].score = course.works[0].maxScore + 1;
      else course.works[0].weight = 44;
    }
    const data = await new GetMyGrades(d.repository, d.clock).executeMessages(
      d.anna,
    );
    expect(data.courses).toHaveLength(6);
    expect(
      data.courses.filter((item) => item.calculationStatus === "ready"),
    ).toHaveLength(5);
    expect(data.courses.find((item) => item.id === course.id)).toMatchObject({
      calculationStatus: "unavailable",
      currentScore: null,
      secured: null,
      forecast: null,
      grade: null,
      light: { code: "clarification" },
    });
    expect(data.summary).toMatchObject({
      averageScore: 90,
      inGoodShape: 5,
      needsAttention: 1,
    });
    const detail = await new GetCourseGrades(d.repository, d.clock).execute(
      d.anna,
      { courseId: course.id },
    );
    expect(detail.course.calculationStatus).toBe("unavailable");
    expect(detail.course.exams).toHaveLength(1);
  },
);

it("сначала красные, затем жёлтые, затем зелёные дисциплины", async () => {
  const d = gradesFixture();
  const get = new GetMyGrades(d.repository, d.clock);
  expect((await get.executeMessages(d.anna)).courses[0]?.title).toBe(
    "Иностранный язык",
  );
  const timur = await get.executeMessages(d.timur);
  expect(timur.courses.map((course) => course.light.tone)).toEqual([
    "danger",
    "warning",
    "success",
    "success",
    "success",
    "success",
  ]);
  expect(timur.courses[0]?.title).toBe("Основы маркетинга");
});

it("utm и подставленные query-идентификаторы не влияют на собственную сводку", async () => {
  const d = gradesFixture();
  const get = new GetMyGrades(d.repository, d.clock);
  const baseline = await get.executeMessages(d.anna);
  expect(
    await get.executeMessages(d.anna, {
      utm_source: "x",
      studentId: d.ctx.row("student:timur").id,
      userId: "foreign",
      groupId: "imp",
      courseId: d.ctx.row("course:imp:0").id,
    }),
  ).toEqual(baseline);
});

it("симулятор начинает с 77 у Анны, с максимума при недостижимой цели", () => {
  const d = gradesFixture();
  const works = d.records.get(d.ctx.row("student:anna").id)?.courses[0]?.works;
  const remaining = works?.find((work) => work.score === null);
  if (!works || !remaining) throw new Error("Нет работ.");
  expect(initialPredictions(works, 86)).toEqual({ [remaining.id]: 77 });
  expect(
    calculateWhatIf(works, initialPredictions(works, 86), 86).total,
  ).toBeCloseTo(86);
  expect(initialPredictions(works, 100)).toEqual({ [remaining.id]: 100 });
});

it("начальные баллы нескольких работ вместе достигают цели", () => {
  const d = gradesFixture();
  const works = d.records.get(d.ctx.row("student:anna").id)?.courses[0]?.works;
  if (!works) throw new Error("Нет работ.");
  const pending = works.map((work, index) => ({
    ...work,
    weight: index === 2 ? 40 : 30,
    score: null,
  }));
  const predictions = initialPredictions(pending, 86);
  expect(
    calculateWhatIf(pending, predictions, 86).total,
  ).toBeGreaterThanOrEqual(86);
  for (const work of pending)
    expect(predictions[work.id]).toBeLessThanOrEqual(work.maxScore);
});

it("пример ревью: минимум 68, точные 86, оценка и светофор в DTO", async () => {
  const d = gradesFixture();
  const record = d.records.get(d.ctx.row("student:anna").id);
  const course = record?.courses[0];
  if (!record || !course) throw new Error("Нет дисциплины.");
  const scores = [77, 99, null];
  course.works = course.works.map((work, index) => ({
    ...work,
    score: scores[index] ?? null,
  }));
  const pending = course.works[2];
  if (!pending) throw new Error("Нет последней работы.");
  const data = await new GetCourseGrades(d.repository, d.clock).execute(
    d.anna,
    {
      courseId: course.id,
    },
  );
  expect(data.course.forecast?.remaining[0]?.minimum).toBe(68);
  expect(initialPredictions(data.course.works, 86)).toEqual({
    [pending.id]: 68,
  });
  expect(
    calculateWhatIf(data.course.works, { [pending.id]: 68 }, 86),
  ).toMatchObject({
    total: 86,
    grade: { code: "excellent", credit: true },
  });
  pending.score = 68;
  const completed = await new GetMyGrades(
    d.repository,
    d.clock,
  ).executeMessages(d.anna);
  expect(completed.courses.find((item) => item.id === course.id)).toMatchObject(
    {
      secured: 86,
      currentScore: 86,
      forecast: { total: 86, targetReachable: true },
      grade: { code: "excellent", credit: true },
      light: { tone: "success" },
    },
  );
  expect(completed.summary).toMatchObject({
    inGoodShape: 6,
    needsAttention: 0,
  });
  expect(JSON.parse(JSON.stringify(completed))).toEqual(completed);
});

it("DTO округляет число отдельно от решения об оценке и цели", async () => {
  const d = gradesFixture();
  const course = d.records.get(d.ctx.row("student:anna").id)?.courses[0];
  if (!course) throw new Error("Нет дисциплины.");
  const values = [
    { weight: 85, maxScore: 1, score: 1 },
    { weight: 1, maxScore: 1e17, score: 1e17 - 16 },
    { weight: 14, maxScore: 100, score: 0 },
  ];
  course.works = course.works.map((work, index) => ({
    ...work,
    ...values[index],
  }));
  const data = await new GetCourseGrades(d.repository, d.clock).execute(
    d.anna,
    {
      courseId: course.id,
    },
  );
  expect(data.course).toMatchObject({
    secured: 86,
    grade: { code: "good" },
    forecast: { targetReachable: false },
    light: { tone: "warning" },
  });
  expect(JSON.parse(JSON.stringify(data))).toEqual(data);
});

it("средний текущий балл четырёх дисциплин достигает ровно цели 86", async () => {
  const d = gradesFixture();
  const record = d.records.get(d.ctx.row("student:anna").id);
  if (!record) throw new Error("Нет записи.");
  record.courses = record.courses.slice(0, 4).map((course, index) => ({
    ...course,
    works: course.works.map((work) => ({
      ...work,
      score: [89.06, 94.64, 85.22, 75.08][index] ?? 0,
    })),
  }));
  const data = await new GetMyGrades(d.repository, d.clock).executeMessages(
    d.anna,
  );
  expect(data.summary.averageScore).toBe(86);
  expect(data.summary.averageScore).toBeGreaterThanOrEqual(data.targetScore);
});
