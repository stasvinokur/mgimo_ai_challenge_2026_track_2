import type { Sql } from "postgres";
import type { AttendanceCourses } from "@/application/attendance/qr-ports";

export class PostgresAttendanceCourses implements AttendanceCourses {
  constructor(private readonly database: () => Sql) {}
  async listForStudent(studentId: string) {
    return this.database()<
      { slotId: string; courseId: string; title: string }[]
    >`
      select sl.id as "slotId", c.id as "courseId", c.title
      from students s join schedule_slots sl on sl.group_id = s.group_id join courses c on c.id = sl.course_id
      where s.id = ${studentId} order by c.title, sl.id`;
  }
}
