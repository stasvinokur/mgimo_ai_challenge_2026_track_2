import { expect, it } from "vitest";
import { GetCourseActions } from "@/application/grades/get-course-actions";
import type { Actor } from "@/application/ports/actor";
import { ForbiddenError, NotFoundError } from "@/application/shared/errors";
import { gradesFixture } from "../fakes/grades";

it.each(["debt", "warning", "danger", "soon", "none"])(
  "варианты %s используют только данные студента и сериализуются",
  async (scenario) => {
    const d = gradesFixture();
    const actor = scenario === "debt" ? d.timur : d.anna;
    const record = d.records.get(
      actor.kind === "student" ? actor.studentId : "",
    );
    const course = record?.courses[0];
    if (!course || !record) throw new Error("Нужна дисциплина.");
    if (scenario === "danger") for (const item of course.works) item.score = 0;
    if (scenario === "none") for (const item of course.works) item.score = 100;
    if (scenario === "soon") {
      for (const item of course.works) item.score = item.maxScore;
      const pending = course.works[2];
      if (!pending) throw new Error("Нужна работа.");
      pending.score = null;
    }
    const before = structuredClone(record);
    const result = await new GetCourseActions(d.repository, d.clock).execute(
      actor,
      { courseId: course.id },
    );
    expect(result === null).toBe(scenario === "none");
    if (result) {
      expect(result.courseTitle).toBe(course.title);
      expect(result.options.length + 1).toBeGreaterThanOrEqual(2);
      expect(result.options.length + 1).toBeLessThanOrEqual(3);
      expect(result.appeal.question).toContain(course.title);
      expect(result.appeal.question).toContain("Вопрос по дисциплине");
      const selectedWork = course.works.find(
        (work) => work.id === result.workId,
      );
      expect(result.assistantContext).toEqual({
        workTitle: selectedWork?.title ?? null,
        dueAt: selectedWork?.dueAt ?? null,
        overdue: selectedWork
          ? Date.parse(selectedWork.dueAt) < d.clock.now().getTime()
          : false,
        total: result.options[0]?.baseline,
        target: record.targetScore,
      });
      expect(result).not.toHaveProperty("assistantQuestion");
      for (const option of result.options) {
        expect(["overdue", "submit", "review"]).toContain(option.code);
        expect(option).not.toHaveProperty("title");
        expect(option).not.toHaveProperty("description");
        expect(option).not.toHaveProperty("effect");
        expect(
          option.notes.every(
            (note) =>
              note === "other-work-zero" || note === "required-confirmation",
          ),
        ).toBe(true);
      }
    }
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(d.repository.calls).toEqual([
      { studentId: actor.kind === "student" ? actor.studentId : "" },
    ]);
    expect(record).toEqual(before);
  },
);

it("чужие и отсутствующие courseId/workId одинаково NotFound, workId принадлежит выбранной дисциплине", async () => {
  const d = gradesFixture();
  const useCase = new GetCourseActions(d.repository, d.clock);
  const own = d.ctx.row("course:fmo:0").id;
  const other = d.ctx.row("course:imp:0").id;
  const unknown = "00000000-0000-7000-8000-000000ffffee";
  for (const input of [
    { courseId: other },
    { courseId: unknown },
    { courseId: own, workId: unknown },
    { courseId: own, workId: d.ctx.row("assessment:imp:0:0").id },
    { courseId: own, workId: d.ctx.row("assessment:fmo:1:0").id },
  ])
    await expect(useCase.execute(d.anna, input)).rejects.toEqual(
      new NotFoundError(),
    );
  const workId = d.ctx.row("assessment:fmo:0:2").id;
  expect(
    await useCase.execute(d.anna, { courseId: own, workId }),
  ).toMatchObject({ workId });
});

it.each(["studentId", "userId", "groupId", "predictions"])(
  "параметр %s от клиента запрещён до чтения БД",
  async (key) => {
    const d = gradesFixture();
    await expect(
      new GetCourseActions(d.repository, d.clock).execute(d.anna, {
        courseId: d.ctx.row("course:fmo:0").id,
        [key]: "foreign",
      }),
    ).rejects.toThrow(NotFoundError);
    expect(d.repository.calls).toEqual([]);
  },
);

it.each([
  { courseId: "invalid" },
  { courseId: ["a", "b"] },
  { courseId: "00000000-0000-7000-8000-000000ffffee", workId: ["a"] },
])(
  "некорректные и повторяющиеся параметры не проходят схему",
  async (input) => {
    const d = gradesFixture();
    await expect(
      new GetCourseActions(d.repository, d.clock).execute(d.anna, input),
    ).rejects.toThrow(NotFoundError);
    expect(d.repository.calls).toEqual([]);
  },
);

it("сотрудник запрещён до чтения репозитория; некорректные учебные данные не дают выдуманного текста", async () => {
  const d = gradesFixture();
  const useCase = new GetCourseActions(d.repository, d.clock);
  const staff: Actor = {
    kind: "staff",
    userId: "staff",
    staffId: "staff",
    facultyIds: [],
  };
  await expect(useCase.execute(staff, {})).rejects.toThrow(ForbiddenError);
  expect(d.repository.calls).toEqual([]);
  const course = d.records.get(d.ctx.row("student:anna").id)?.courses[0];
  if (!course) throw new Error("Нужна дисциплина.");
  course.works = [];
  expect(await useCase.execute(d.anna, { courseId: course.id })).toBeNull();
});
