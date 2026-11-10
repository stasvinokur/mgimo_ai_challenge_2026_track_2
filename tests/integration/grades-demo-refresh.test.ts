import { describe, expect, it } from "vitest";
import {
  GetCourseGrades,
  GetMyGrades,
} from "@/application/grades/get-my-grades";
import type { Actor } from "@/application/ports/actor";
import type { RateLimiter } from "@/application/ports/rate-limiter";
import { SetTeacherGrade } from "@/application/teacher/gradebook";
import { moscowDate, weekday } from "@/domain/schedule/dates";
import { PostgresGradesRepository } from "@/infrastructure/db/repositories/grades/grades";
import { PostgresTeacherGradebookUnitOfWork } from "@/infrastructure/db/repositories/teacher/gradebook";
import { fixtureContext } from "../../scripts/fixtures/shared";
import { buildDemoFixtures, refreshDemo, seedDemo } from "../../scripts/seed";
import { FakeClock } from "../fakes/clock";
import { openStudentTestData } from "./student-e2e-data";
import { openTeacherTestData } from "./teacher-e2e-data";
import {
  openTeacherGradesTestData,
  teacherGradeEntryKey,
} from "./teacher-grades-data";

const unlimited: RateLimiter = {
  async reserve() {
    return { async commitFailure() {}, async release() {} };
  },
};

describe.skipIf(!process.env.DATABASE_URL)(
  "Восстановление демо-оценок D-47",
  () => {
    it("возвращает долг и прогноз засеянных студентов, сохраняя оценки и историю остальных", async () => {
      const teacher = await openTeacherTestData();
      const { sql, ids } = teacher;
      const clock = new FakeClock(new Date());
      const initialTime = clock.now();
      const extras: string[] = [];
      let external:
        | Awaited<ReturnType<typeof openTeacherGradesTestData>>
        | undefined;
      let other: Awaited<ReturnType<typeof openStudentTestData>> | undefined;
      try {
        await seedDemo(sql, clock);
        await refreshDemo(sql, clock);
        external = await openTeacherGradesTestData();
        other = await openStudentTestData("anna");
        await sql`update students set seed_key = ${`custom:student:${ids.next()}`} where id = ${other.actor.studentId}`;

        type DemoStudent = {
          id: string;
          userId: string;
          facultyId: string;
          groupId: string;
          seedKey: string;
        };
        const students = await sql<DemoStudent[]>`
        select id, user_id as "userId", faculty_id as "facultyId",
          group_id as "groupId", seed_key as "seedKey"
        from students where seed_key in ('demo:student:anna', 'demo:student:timur')`;
        const anna = students.find(
          (row) => row.seedKey === "demo:student:anna",
        );
        const timur = students.find(
          (row) => row.seedKey === "demo:student:timur",
        );
        if (!anna || !timur) throw new Error("Нет засеянных демо-студентов.");
        const actor = (student: DemoStudent): Actor => ({
          kind: "student",
          studentId: student.id,
          userId: student.userId,
          facultyId: student.facultyId,
        });
        const [annaWork] = await sql<
          {
            id: string;
            courseId: string;
            seedKey: string;
          }[]
        >`select id, course_id as "courseId", seed_key as "seedKey"
        from assessments where seed_key = 'demo:assessment:fmo:0:0'`;
        const [timurWork] = await sql<
          {
            id: string;
            courseId: string;
            seedKey: string;
          }[]
        >`select id, course_id as "courseId", seed_key as "seedKey"
        from assessments where seed_key = 'demo:assessment:imp:0:0'`;
        if (!annaWork || !timurWork)
          throw new Error("Нет учебных работ демо-сценария.");
        const occurrenceDate = moscowDate(clock.now());
        const slots = [];
        for (const [student, work] of [
          [anna, annaWork],
          [timur, timurWork],
        ] as const) {
          const slotId = ids.next();
          await sql`insert into schedule_slots (id, group_id, course_id, teacher_id,
          room_id, weekday, starts_at, ends_at, kind, week_parity)
          select ${slotId}, ${student.groupId}, ${work.courseId}, ${teacher.actor.teacherId},
            room_id, ${weekday(occurrenceDate)}, '09:00', '10:30', 'seminar', 'any'
          from schedule_slots where id = ${teacher.slotId}`;
          slots.push({ slotId, occurrenceDate });
        }
        const annaLesson = slots[0],
          timurLesson = slots[1];
        if (!annaLesson || !timurLesson)
          throw new Error("Нет временных ведомостей.");
        const repository = new PostgresGradesRepository(() => sql);
        const getCourse = new GetCourseGrades(repository, clock);
        const getGrades = new GetMyGrades(repository, clock);
        const annaBefore = await getCourse.execute(actor(anna), {
          courseId: annaWork.courseId,
        });
        const timurBefore = await getGrades.execute(actor(timur));
        expect(annaBefore.course.forecast?.remaining[0]?.minimum).toBe(77);
        expect(timurBefore.summary.openDebts).toBe(1);
        const change = new SetTeacherGrade(
          new PostgresTeacherGradebookUnitOfWork(() => sql, ids),
          clock,
          ids,
          unlimited,
        );
        await change.execute(teacher.actor, {
          ...annaLesson,
          entryKey: teacherGradeEntryKey(annaWork.id, anna.id),
          score: 10,
          expectedScore: 88,
          reason: "entry_error",
        });
        await change.execute(teacher.actor, {
          ...timurLesson,
          entryKey: teacherGradeEntryKey(timurWork.id, timur.id),
          score: 100,
          expectedScore: null,
        });
        expect((await getGrades.execute(actor(timur))).summary.openDebts).toBe(
          0,
        );
        expect(
          (
            await getCourse.execute(actor(anna), {
              courseId: annaWork.courseId,
            })
          ).course.forecast,
        ).not.toEqual(annaBefore.course.forecast);

        await change.execute(teacher.actor, {
          ...annaLesson,
          entryKey: teacherGradeEntryKey(annaWork.id, other.actor.studentId),
          score: 96,
          expectedScore: 88,
          reason: "retake",
        });
        const externalData = external;
        const externalChange = new SetTeacherGrade(
          new PostgresTeacherGradebookUnitOfWork(
            () => externalData.teacher.sql,
            externalData.teacher.ids,
          ),
          clock,
          externalData.teacher.ids,
          unlimited,
        );
        await externalChange.execute(external.teacher.actor, {
          ...external.key,
          entryKey: external.entryKey,
          score: 75,
          expectedScore: null,
        });
        const externalUsers = [
          external.student.actor.userId,
          other.actor.userId,
        ];
        const externalStudents = [
          external.student.actor.studentId,
          other.actor.studentId,
        ];
        const outsideSnapshot = async () => ({
          scores: [
            ...(await sql`select id, student_id, assessment_id, score, graded_at
          from scores where student_id in ${sql(externalStudents)} order by id`),
          ],
          events: [
            ...(await sql`select * from score_events where student_id in ${sql(externalStudents)} order by id`),
          ],
          notifications: [
            ...(await sql`select * from notifications where user_id in ${sql(externalUsers)} order by id`),
          ],
        });
        const outsideBefore = await outsideSnapshot();
        for (const [kind, title, link] of [
          ["change", "Изменение расписания", `/grades/${annaWork.courseId}`],
          [
            "news",
            "Новая оценка: учебное объявление",
            `/grades/${annaWork.courseId}`,
          ],
          ["change", "Новая оценка: учебное объявление", "/notifications"],
        ] as const) {
          const id = ids.next();
          extras.push(id);
          await sql`insert into notifications (id, user_id, kind, title, body, link)
          values (${id}, ${anna.userId}, ${kind}, ${title}, 'Другая категория уведомления', ${link})`;
        }
        const demoEvents =
          await sql`select id from score_events where student_id in (${anna.id}, ${timur.id}) and seed_key is null`;
        expect(demoEvents).toHaveLength(2);
        const [seededEvent] =
          await sql`select id from score_events where seed_key = 'demo:score-event:anna:appeal'`;
        if (!seededEvent) throw new Error("Нет засеянной апелляции.");
        // Existing installations still have the old seed's display text.
        await sql`update score_events set reason = 'Пересмотр после апелляции' where id = ${seededEvent.id}`;

        clock.advance(2 * 86_400_000);
        await refreshDemo(sql, clock);
        const annaAfter = await getCourse.execute(actor(anna), {
          courseId: annaWork.courseId,
        });
        expect(annaAfter.course.secured).toBe(annaBefore.course.secured);
        expect(annaAfter.course.forecast).toEqual(annaBefore.course.forecast);
        expect((await getGrades.execute(actor(timur))).summary.openDebts).toBe(
          1,
        );
        const restored = await sql<
          { seedKey: string; score: number | null; gradedAt: Date | null }[]
        >`
        select seed_key as "seedKey", score, graded_at as "gradedAt" from scores
        where student_id in (${anna.id}, ${timur.id}) and seed_key is not null order by seed_key`;
        const expected = buildDemoFixtures(fixtureContext(clock, ids)).scores;
        for (const row of restored) {
          const fixture = expected.find((item) => item.seedKey === row.seedKey);
          expect(fixture).toBeDefined();
          expect(row.score).toBe(fixture?.score ?? null);
          expect(row.gradedAt).toEqual(fixture?.gradedAt ?? null);
        }
        expect(
          await sql`select id from score_events where student_id in (${anna.id}, ${timur.id}) and seed_key is null`,
        ).toHaveLength(0);
        expect(
          await sql`select id from notifications where user_id in (${anna.userId}, ${timur.userId})
        and seed_key is null and kind = 'change' and title like 'Новая оценка: %'
        and link ~ '^/grades/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
        ).toHaveLength(0);
        expect(
          await sql`select id, reason from score_events where seed_key = 'demo:score-event:anna:appeal'`,
        ).toEqual([{ id: seededEvent.id, reason: "appeal_review" }]);
        expect(
          await sql`select id from notifications where id in ${sql(extras)} order by id`,
        ).toHaveLength(0);
        expect(await outsideSnapshot()).toEqual(outsideBefore);
        await refreshDemo(sql, clock);
        expect(await outsideSnapshot()).toEqual(outsideBefore);
      } finally {
        clock.set(initialTime);
        try {
          if (extras.length)
            await sql`delete from notifications where id in ${sql(extras)}`;
          await refreshDemo(sql, clock, { force: true });
        } finally {
          try {
            await other?.close();
            await external?.close();
          } finally {
            await teacher.close();
          }
        }
      }
    }, 30_000);
  },
);
