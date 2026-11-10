import type { Sql } from "postgres";
import type {
  CourseGrades,
  GradesRecord,
  GradesRepository,
} from "@/application/grades/ports";

export class PostgresGradesRepository implements GradesRepository {
  constructor(private readonly database: () => Sql) {}

  listForStudent(studentId: string) {
    return this.readForStudent(studentId);
  }

  findByIdForStudent(courseId: string, studentId: string) {
    return this.readForStudent(studentId, courseId);
  }

  private async readForStudent(
    studentId: string,
    courseId?: string,
  ): Promise<GradesRecord | null> {
    const sql = this.database();
    const [student] = await sql<
      Pick<GradesRecord, "targetScore" | "scholarship">[]
    >`
      select target_score as "targetScore", scholarship from students where id = ${studentId}`;
    if (!student) return null;
    const rows = await sql<{ id: string; title: string }[]>`
      select c.id, c.title from courses c
      where (${courseId ?? null}::uuid is null or c.id = ${courseId ?? null}::uuid)
      and (exists (select 1 from assessments a join students s on s.group_id = a.group_id
        where s.id = ${studentId} and a.course_id = c.id)
      or exists (select 1 from sessions_exams e join students s on s.group_id = e.group_id
        where s.id = ${studentId} and e.course_id = c.id))
      order by c.title, c.id`;
    if (courseId && rows.length === 0) return null;
    const works = await sql<
      (Omit<CourseGrades["works"][number], "dueAt"> & {
        courseId: string;
        dueAt: Date;
      })[]
    >`
      select a.id, a.course_id as "courseId", a.title, a.weight, a.max_score as "maxScore",
        a.is_required as "isRequired", a.due_at as "dueAt", sc.score
      from assessments a join students s on s.group_id = a.group_id
      left join scores sc on sc.assessment_id = a.id and sc.student_id = s.id
      where s.id = ${studentId}
        and (${courseId ?? null}::uuid is null or a.course_id = ${courseId ?? null}::uuid)
      order by a.due_at, a.id`;
    const exams = await sql<
      (Omit<CourseGrades["exams"][number], "at"> & {
        courseId: string;
        at: Date;
      })[]
    >`
      select e.id, e.course_id as "courseId", e.kind, e.at, r.title as room
      from sessions_exams e join students s on s.group_id = e.group_id
      join rooms r on r.id = e.room_id
      where s.id = ${studentId}
        and (${courseId ?? null}::uuid is null or e.course_id = ${courseId ?? null}::uuid)
      order by e.at, e.id`;
    return {
      targetScore: student.targetScore,
      scholarship: student.scholarship,
      courses: rows.map((course) => ({
        ...course,
        works: works
          .filter((work) => work.courseId === course.id)
          .map(({ courseId: _courseId, dueAt, ...work }) => ({
            ...work,
            dueAt: dueAt.toISOString(),
          })),
        exams: exams
          .filter((exam) => exam.courseId === course.id)
          .map(({ courseId: _courseId, at, ...exam }) => ({
            ...exam,
            at: at.toISOString(),
          })),
      })),
    };
  }
}
