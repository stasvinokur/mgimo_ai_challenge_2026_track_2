import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GetScoreHistory } from "@/application/grades/history";
import { NotFoundError } from "@/application/shared/errors";
import { PostgresGradesRepository } from "@/infrastructure/db/repositories/grades/grades";
import { PostgresScoreHistoryRepository } from "@/infrastructure/db/repositories/grades/history";
import { openTeacherGradesTestData } from "./teacher-grades-data";

describe.skipIf(!process.env.DATABASE_URL)(
  "История оценок в PostgreSQL",
  () => {
    let f: Awaited<ReturnType<typeof openTeacherGradesTestData>>;
    let history: PostgresScoreHistoryRepository;
    let get: GetScoreHistory;

    beforeAll(async () => {
      f = await openTeacherGradesTestData();
      history = new PostgresScoreHistoryRepository(() => f.teacher.sql);
      get = new GetScoreHistory(
        new PostgresGradesRepository(() => f.teacher.sql),
        history,
      );
      const { sql, ids } = f.teacher;
      for (const [student, previous, next, reason, at] of [
        [f.student, null, 80, null, "2026-11-05T12:00:00Z"],
        [f.student, 80, 90, "appeal_review", "2026-11-05T12:01:00Z"],
        [
          f.otherStudent,
          null,
          60,
          "Личная запись второго студента",
          "2026-11-05T12:02:00Z",
        ],
      ] as const) {
        await sql`insert into score_events (id, assessment_id, student_id, student_user_id, previous_score, new_score, changed_by_user_id, reason, created_at) values (${ids.next()}, ${f.workId}, ${student.actor.studentId}, ${student.actor.userId}, ${previous}, ${next}, ${f.teacher.actor.userId}, ${reason}, ${at}::timestamptz)`;
      }
    }, 30_000);

    afterAll(async () => {
      await f?.close();
    });

    it("отдаёт только свои события в общей группе, ISO, порядок от новых и минимум полей", async () => {
      const data = await get.execute(f.student.actor, { courseId: f.courseId });
      expect(data.entries).toHaveLength(2);
      expect(
        data.entries.map((entry) => [entry.previousScore, entry.newScore]),
      ).toEqual([
        [80, 90],
        [null, 80],
      ]);
      expect(data.entries[0]).toEqual({
        id: expect.any(String),
        assessmentTitle: f.workTitle,
        previousScore: 80,
        newScore: 90,
        reason: "appeal_review",
        createdAt: "2026-11-05T12:01:00.000Z",
      });
      expect(JSON.stringify(data)).not.toContain(
        "Личная запись второго студента",
      );
      expect(JSON.stringify(data)).not.toContain(f.teacher.actor.userId);
      const other = await get.execute(f.otherStudent.actor, {
        courseId: f.courseId,
      });
      expect(other.entries.map((entry) => entry.newScore)).toEqual([60]);
      expect(other.entries[0]?.reason).toBe("clarification");
      expect(JSON.stringify(other)).not.toContain(
        "Личная запись второго студента",
      );
    });

    it("чужая и отсутствующая дисциплина неотличимы; репозиторий также фильтрует курс", async () => {
      const courseId = f.teacher.ids.next();
      await expect(get.execute(f.student.actor, { courseId })).rejects.toThrow(
        NotFoundError,
      );
      expect(
        await history.listForStudentCourse(courseId, f.student.actor.studentId),
      ).toEqual([]);
      const [foreign] = await f.teacher.sql<
        { id: string }[]
      >`select a.course_id as id from assessments a join students s on s.group_id = a.group_id where s.seed_key = 'demo:student:timur' limit 1`;
      if (!foreign) throw new Error("Нет чужой учебной дисциплины.");
      await expect(
        get.execute(f.student.actor, { courseId: foreign.id }),
      ).rejects.toThrow(NotFoundError);
      expect(
        await history.listForStudentCourse(
          foreign.id,
          f.student.actor.studentId,
        ),
      ).toEqual([]);
    });
  },
);
