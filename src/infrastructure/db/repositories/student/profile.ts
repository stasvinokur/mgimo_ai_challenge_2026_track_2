import type { Sql } from "postgres";
import type {
  StudentProfile,
  StudentRepository,
} from "@/application/student/ports";

export class PostgresStudentRepository implements StudentRepository {
  constructor(private readonly database: () => Sql) {}

  async findProfileForStudent(
    studentId: string,
  ): Promise<StudentProfile | null> {
    const [profile] = await this.database()<
      StudentProfile[]
    >`select s.full_name as "fullName", f.title as faculty, p.title as program, s.course, g.title as "group", s.record_book_no as "recordBookNo", s.scholarship from students s join faculties f on f.id = s.faculty_id join programs p on p.id = s.program_id join groups g on g.id = s.group_id where s.id = ${studentId}`;
    return profile ?? null;
  }
}
