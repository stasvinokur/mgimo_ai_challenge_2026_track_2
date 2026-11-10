import { expect, it } from "vitest";
import { GetMyGrades } from "../../src/application/grades/get-my-grades";
import { calculateScholarship } from "../../src/application/grades/scholarship";
import { ForbiddenError } from "../../src/application/shared/errors";
import { gradesFixture } from "../fakes/grades";
import { todayFixture } from "../fakes/today";

it("Анна: прогноз отдельно от текущей стипендии, минимум 77, 76/77 и пропуск", async () => {
  const d = gradesFixture();
  const data = await new GetMyGrades(d.repository, d.clock).executeMessages(
    d.anna,
  );
  const course = data.courses.find((item) => item.title === "Иностранный язык");
  const work = course?.works.find((item) => item.score === null);
  if (!course || !work) throw new Error("Нет вымышленной работы.");
  expect(data.scholarship.level).toBe("academic");
  expect(data.scholarship.currentScholarship).toBe("increased");
  expect(data.scholarship.outlook.state).toBe("at-risk");
  expect(data.scholarship.outlook.requirement).toMatchObject({
    minimum: 77,
    maxScore: 100,
  });
  expect(data.scholarship.next).toMatchObject({
    level: "increased",
    reachable: true,
  });
  expect(
    data.scholarship.next?.courses.find((item) => item.courseId === course.id)
      ?.requirements,
  ).toEqual([
    { workId: work.id, title: work.title, minimum: 77, maxScore: 100 },
  ]);
  const before = structuredClone(data);
  const forecast = (score: number, skipped = false) =>
    calculateScholarship(data.courses, data.scholarship.currentScholarship, {
      courseId: course.id,
      predictions: { [work.id]: score },
      skipped: { [work.id]: skipped },
    });
  expect(forecast(76).level).toBe("academic");
  expect(forecast(76).outlook.state).toBe("at-risk");
  expect(forecast(77).level).toBe("increased");
  expect(forecast(77).outlook).toMatchObject({
    state: "retained",
    currentScholarship: "increased",
  });
  expect(forecast(100).level).toBe("increased");
  expect(forecast(0, true).level).toBe("none");
  expect(forecast(0, true).outlook.state).toBe("debt");
  expect(forecast(0, true).blockers.some((item) => item.code === "debt")).toBe(
    true,
  );
  expect(data).toEqual(before);
  expect(JSON.parse(JSON.stringify(data))).toEqual(data);
});

it("Тимур: долг и причина, клиентский расчёт не сохраняет предполагаемую сдачу", async () => {
  const d = gradesFixture();
  const get = new GetMyGrades(d.repository, d.clock);
  const data = await get.executeMessages(d.timur);
  expect(data.scholarship.level).toBe("none");
  expect(data.scholarship.currentScholarship).toBe("none");
  expect(data.scholarship.outlook).toMatchObject({
    state: "debt",
    currentScholarship: "none",
    debtTitle: "Основы маркетинга",
  });
  expect(data.scholarship.blockers).toContainEqual(
    expect.objectContaining({
      title: "Основы маркетинга",
      code: "debt",
    }),
  );
  const course = data.courses.find((item) => item.openDebts > 0);
  if (!course) throw new Error("Нет вымышленного долга.");
  calculateScholarship(data.courses, data.scholarship.currentScholarship, {
    courseId: course.id,
    predictions: Object.fromEntries(
      course.works
        .filter((item) => item.score === null)
        .map((item) => [item.id, item.maxScore]),
    ),
    skipped: {},
  });
  expect((await get.executeMessages(d.timur)).scholarship).toEqual(
    data.scholarship,
  );
});

it("прогноз читает только actor.studentId, query не подменяет владельца, staff запрещён", async () => {
  const d = gradesFixture();
  const get = new GetMyGrades(d.repository, d.clock);
  const data = await get.executeMessages(d.anna, {
    studentId: d.ctx.row("student:timur").id,
    userId: d.timur.userId,
  });
  expect(data.scholarship.level).toBe("academic");
  expect(d.repository.calls).toEqual([
    { studentId: d.ctx.row("student:anna").id },
  ]);
  await expect(
    get.executeMessages({
      kind: "staff",
      userId: "staff",
      staffId: "staff",
      facultyIds: [],
    }),
  ).rejects.toThrow(ForbiddenError);
  expect(d.repository.calls).toHaveLength(1);
});

it("неверные оценки одной дисциплины не ломают прогноз и остальные минимумы", async () => {
  const d = gradesFixture();
  const record = d.records.get(d.ctx.row("student:anna").id);
  const course = record?.courses.find(
    (item) => item.title !== "Иностранный язык",
  );
  if (!course) throw new Error("Нет вымышленной дисциплины.");
  course.works = [];
  const data = await new GetMyGrades(d.repository, d.clock).executeMessages(
    d.anna,
  );
  expect(data.scholarship.status).toBe("clarification");
  expect(
    data.scholarship.blockers.some(
      (item) => item.courseId === course.id && item.code === "clarification",
    ),
  ).toBe(true);
  expect(
    data.courses.filter((item) => item.calculationStatus === "ready"),
  ).toHaveLength(5);
});

it("Сегодня получает тот же прогноз; сбой grades остаётся изолированным", async () => {
  const d = todayFixture();
  const data = await d.overview.execute(d.anna);
  const grades = await new GetMyGrades(d.repository, d.clock).execute(d.anna);
  const forecast = grades.scholarship;
  const requirements =
    forecast.next?.courses.flatMap((course) =>
      course.requirements.map((work) => ({ ...work, course: course.title })),
    ) ?? [];
  const first = requirements.find((work) => work.minimum > 0);
  expect(data.study.ok && data.study.data.scholarship).toEqual({
    state: forecast.outlook.state,
    current: forecast.currentScholarship,
    level: forecast.level,
    goalLevel: forecast.next?.level ?? null,
    goalReachable: forecast.next?.reachable ?? null,
    debtCourse:
      grades.courses.find((course) => course.openDebts > 0)?.title ?? null,
    requirement: first
      ? {
          minimum: first.minimum,
          maxScore: first.maxScore,
          title: first.title,
          course: first.course,
        }
      : null,
    moreRequirements: requirements.length > 1,
  });
  d.failures.add("grades");
  const failed = await d.overview.execute(d.anna);
  expect(failed.study.ok).toBe(false);
  expect(failed.schedule.ok).toBe(true);
});

it("первая строка зависит от стипендии профиля при одинаковых оценках", async () => {
  const d = gradesFixture();
  const data = await new GetMyGrades(d.repository, d.clock).executeMessages(
    d.anna,
  );
  const academic = calculateScholarship(data.courses, "academic");
  expect(academic.outlook).toMatchObject({
    state: "retained",
    currentScholarship: "academic",
    increasedOutlook: "reachable",
    requirement: { minimum: 77 },
  });
  const none = calculateScholarship(data.courses, "none");
  expect(none.outlook).toMatchObject({
    state: "eligible",
    currentScholarship: "none",
    level: "academic",
  });
  const allPassed = data.courses.map((course) => ({
    ...course,
    works: course.works.map((work) => ({ ...work, score: work.maxScore })),
  }));
  expect(calculateScholarship(allPassed, "none").outlook).toMatchObject({
    state: "eligible",
    currentScholarship: "none",
    level: "increased",
    increasedOutlook: "eligible",
  });
});

it("для сохранения повышенной нужен порог 86 даже при набранном итоге ниже 70", async () => {
  const d = gradesFixture();
  const data = await new GetMyGrades(d.repository, d.clock).executeMessages(
    d.anna,
  );
  const course = data.courses[0];
  const first = course?.works[0];
  const pending = course?.works.find((work) => work.score === null);
  if (!course || !first || !pending) throw new Error("Нет вымышленной работы.");
  const forecast = calculateScholarship(
    [
      {
        ...course,
        works: [
          { ...first, weight: 10, score: 0 },
          { ...pending, weight: 90 },
        ],
      },
    ],
    "increased",
  );
  expect(forecast.level).toBe("none");
  expect(forecast.next).toMatchObject({
    level: "increased",
    threshold: 86,
    reachable: true,
  });
  expect(forecast.next?.courses[0]?.requirements[0]?.minimum).toBe(96);
  expect(forecast.outlook).toMatchObject({
    state: "at-risk",
    requirement: { minimum: 96, maxScore: 100 },
  });
});

it("окончательные оценки 80 сохраняют академическую, но делают повышенную недостижимой", async () => {
  const d = gradesFixture();
  const data = await new GetMyGrades(d.repository, d.clock).executeMessages(
    d.anna,
  );
  const courses = data.courses.map((course) => ({
    ...course,
    works: course.works.map((work) => ({
      ...work,
      score: work.maxScore * 0.8,
    })),
  }));
  expect(calculateScholarship(courses, "increased").outlook).toMatchObject({
    state: "unreachable",
    nextLevel: "increased",
  });
  expect(calculateScholarship(courses, "academic").outlook).toMatchObject({
    state: "retained",
    currentScholarship: "academic",
    increasedOutlook: "unreachable",
  });
});
