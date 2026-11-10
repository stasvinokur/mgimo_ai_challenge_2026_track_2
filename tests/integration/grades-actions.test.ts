import { expect, it } from "vitest";
import { GetCourseActions } from "@/application/grades/get-course-actions";
import { NotFoundError } from "@/application/shared/errors";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresGradesRepository } from "@/infrastructure/db/repositories/grades/grades";
import { FakeClock } from "../fakes/clock";
import { openStudentTestData } from "./student-e2e-data";

it("PostgreSQL: варианты долга, IDOR courseId/workId и отсутствие созданного черновика", async () => {
  const anna = await openStudentTestData("anna");
  const timur = await openStudentTestData("timur");
  const sql = createDatabase(1);
  try {
    if (anna.actor.kind !== "student" || timur.actor.kind !== "student")
      throw new Error("Нужны студенты.");
    const repository = new PostgresGradesRepository(() => sql);
    const record = await repository.listForStudent(timur.actor.studentId);
    const foreign = record?.courses.find(
      (course) => course.title === "Основы маркетинга",
    );
    const work = foreign?.works.find((work) => work.score === null);
    const workId = work?.id;
    const own = (await repository.listForStudent(anna.actor.studentId))
      ?.courses[0];
    if (!foreign || !work || !workId || !own)
      throw new Error("Нужен демо-сид.");
    const useCase = new GetCourseActions(
      repository,
      new FakeClock(new Date(new Date(work.dueAt).getTime() + 1)),
    );
    const before =
      await sql`select id, status, payload from requests where student_id = ${timur.actor.studentId} order by id`;
    for (let n = 0; n < 2; n++) {
      const plan = await useCase.execute(timur.actor, {
        courseId: foreign.id,
        workId,
      });
      expect(plan?.appeal.question).toContain(
        "Текущий итог без новых баллов: 28,8 из 100",
      );
      expect(plan?.workId).toBe(workId);
      expect(plan?.options[0]?.code).toBe("overdue");
    }
    for (const input of [
      { courseId: foreign.id },
      { courseId: own.id, workId },
      { courseId: "00000000-0000-7000-8000-000000ffffee" },
    ])
      await expect(useCase.execute(anna.actor, input)).rejects.toEqual(
        new NotFoundError(),
      );
    expect(
      await sql`select id, status, payload from requests where student_id = ${timur.actor.studentId} order by id`,
    ).toEqual(before);
  } finally {
    await sql.end({ timeout: 1 });
    await timur.close();
    await anna.close();
  }
});
