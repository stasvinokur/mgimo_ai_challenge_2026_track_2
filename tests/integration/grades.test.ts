import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemo } from "../../scripts/seed";
import {
  GetCourseGrades,
  GetMyGrades,
} from "../../src/application/grades/get-my-grades";
import type { Actor } from "../../src/application/ports/actor";
import { NotFoundError } from "../../src/application/shared/errors";
import { createDatabase } from "../../src/infrastructure/db/client";
import { PostgresGradesRepository } from "../../src/infrastructure/db/repositories/grades/grades";
import { UuidV7Generator } from "../../src/infrastructure/system/id-generator";
import { FakeClock } from "../fakes/clock";

describe.skipIf(!process.env.DATABASE_URL)("Успеваемость в PostgreSQL", () => {
  const clock = new FakeClock(new Date());
  let sql: ReturnType<typeof createDatabase>;
  let repository: PostgresGradesRepository;
  let anna: Actor;
  let timur: Actor;

  beforeAll(async () => {
    sql = createDatabase(1);
    await seedDemo(sql, clock);
    repository = new PostgresGradesRepository(() => sql);
    async function actor(name: string): Promise<Actor> {
      const [row] = await sql<
        { id: string; userId: string; facultyId: string }[]
      >`select id, user_id as "userId", faculty_id as "facultyId" from students where seed_key = ${`demo:student:${name}`}`;
      if (!row) throw new Error("Нет вымышленного студента.");
      return {
        kind: "student",
        studentId: row.id,
        userId: row.userId,
        facultyId: row.facultyId,
      };
    }
    anna = await actor("anna");
    timur = await actor("timur");
  }, 30_000);

  afterAll(async () => {
    await sql?.end({ timeout: 1 });
  });

  it("сценарии сида и ISO DTO: Анна 5+1, 77 и 78,3; Тимур — долг", async () => {
    const get = new GetMyGrades(repository, clock);
    const data = await get.executeMessages(anna);
    expect(data.courses).toHaveLength(6);
    expect(data.summary).toMatchObject({
      inGoodShape: 5,
      needsAttention: 1,
      openDebts: 0,
      targetScore: 86,
    });
    expect(data.summary.averageScore).toBeCloseTo(89.5);
    const english = data.courses.find(
      (course) => course.title === "Иностранный язык",
    );
    expect(english?.works.map((work) => work.score)).toEqual([88, 86, null]);
    expect(english?.secured).toBeCloseTo(78.3);
    expect(english?.forecast?.remaining[0]?.minimum).toBe(77);
    expect(english?.light.code).toBe("borderline");
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
      data.scholarship.next?.courses.find(
        (item) => item.courseId === english?.id,
      )?.requirements[0]?.minimum,
    ).toBe(77);
    expect(data.courses.flatMap((course) => course.exams)).toHaveLength(6);
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    const other = await get.executeMessages(timur);
    expect(other.summary.openDebts).toBe(1);
    expect(other.scholarship.level).toBe("none");
    expect(other.scholarship.currentScholarship).toBe("none");
    expect(other.scholarship.outlook.state).toBe("debt");
    expect(other.scholarship.blockers).toContainEqual(
      expect.objectContaining({
        title: "Основы маркетинга",
        code: "debt",
      }),
    );
    expect(
      other.courses.find((course) => course.title === "Основы маркетинга")
        ?.light.code,
    ).toBe("debt");
  });

  it("дисциплина и баллы ограничены группой и studentId владельца в обоих направлениях", async () => {
    if (anna.kind !== "student" || timur.kind !== "student")
      throw new Error("Нужен студент.");
    const a = await repository.listForStudent(anna.studentId);
    const t = await repository.listForStudent(timur.studentId);
    const annaId = a?.courses[0]?.id ?? "";
    const timurId = t?.courses[0]?.id ?? "";
    expect(
      await repository.findByIdForStudent(timurId, anna.studentId),
    ).toBeNull();
    expect(
      await repository.findByIdForStudent(annaId, timur.studentId),
    ).toBeNull();
    const get = new GetCourseGrades(repository, clock);
    await expect(get.execute(anna, { courseId: timurId })).rejects.toEqual(
      new NotFoundError(),
    );
    await expect(get.execute(timur, { courseId: annaId })).rejects.toEqual(
      new NotFoundError(),
    );
    expect(
      await repository.listForStudent("00000000-0000-7000-8000-000000ffffee"),
    ).toBeNull();
  });

  it("работа ИМП в общей дисциплине не видна Анне", async () => {
    if (anna.kind !== "student" || timur.kind !== "student")
      throw new Error("Нужен студент.");
    const record = await repository.listForStudent(anna.studentId);
    const course = record?.courses.find(
      (item) => item.title === "Иностранный язык",
    );
    const [other] = await sql<
      { groupId: string }[]
    >`select group_id as "groupId" from students where id = ${timur.studentId}`;
    if (!course || !other) throw new Error("Нет демо-дисциплины.");
    const ids = new UuidV7Generator();
    const assessmentId = ids.next();
    const scoreId = ids.next();
    try {
      await sql`insert into assessments (id, course_id, group_id, kind, title, weight, max_score, is_required, due_at) values (${assessmentId}, ${course.id}, ${other.groupId}, 'test', 'Работа другой группы', 100, 100, true, ${clock.now().toISOString()}::timestamptz)`;
      await sql`insert into scores (id, assessment_id, student_id, score) values (${scoreId}, ${assessmentId}, ${timur.studentId}, 99)`;
      const own = await repository.findByIdForStudent(
        course.id,
        anna.studentId,
      );
      expect(own?.courses[0]?.works).toEqual(course.works);
      expect(
        (await repository.listForStudent(anna.studentId))?.courses.find(
          (item) => item.id === course.id,
        )?.works,
      ).toEqual(course.works);
      const otherCourse = await repository.findByIdForStudent(
        course.id,
        timur.studentId,
      );
      expect(otherCourse?.courses[0]?.works).toMatchObject([
        { id: assessmentId, score: 99 },
      ]);
      const calculated = await new GetCourseGrades(repository, clock).execute(
        anna,
        { courseId: course.id },
      );
      expect(calculated.course.forecast?.remaining[0]?.minimum).toBe(77);
    } finally {
      await sql`delete from scores where id = ${scoreId}`;
      await sql`delete from assessments where id = ${assessmentId}`;
    }
  });

  it("чтение и расчёт не изменяют scores", async () => {
    const snapshot = () =>
      sql`select id, student_id, assessment_id, score, graded_at from scores order by id`;
    const before = await snapshot();
    await new GetMyGrades(repository, clock).executeMessages(anna);
    await new GetMyGrades(repository, clock).executeMessages(timur);
    expect(await snapshot()).toEqual(before);
  });
});
