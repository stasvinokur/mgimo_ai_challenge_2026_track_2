import type { Sql } from "postgres";
import type {
  ScoreHistoryEntry,
  ScoreHistoryRepository,
} from "@/application/grades/history";

export class PostgresScoreHistoryRepository implements ScoreHistoryRepository {
  constructor(private readonly database: () => Sql) {}

  async listForStudentCourse(courseId: string, studentId: string) {
    const sql = this.database();
    const rows = await sql<
      (Omit<ScoreHistoryEntry, "createdAt"> & { createdAt: Date })[]
    >`
      select ev.id, a.title as "assessmentTitle", ev.previous_score as "previousScore",
        ev.new_score as "newScore", ev.reason, ev.created_at as "createdAt"
      from score_events ev
      join assessments a on a.id = ev.assessment_id
      join students s on s.id = ev.student_id and s.group_id = a.group_id
      where ev.student_id = ${studentId} and a.course_id = ${courseId}
      order by ev.created_at desc, ev.id desc`;
    return rows.map(({ createdAt, ...entry }) => ({
      ...entry,
      createdAt: createdAt.toISOString(),
    }));
  }
}
