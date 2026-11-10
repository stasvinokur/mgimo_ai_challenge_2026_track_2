import {
  GetAttendanceConfirmation,
  GetMyAttendance,
  MarkAttendance,
} from "@/application/attendance/student";
import {
  CloseTeacherAttendance,
  GetTeacherAttendance,
  IssueAttendanceCode,
} from "@/application/attendance/teacher";
import type { Clock } from "@/application/ports/clock";
import { atMoscow, moscowDate, weekday } from "@/domain/schedule/dates";
import { PostgresAttendanceCourses } from "@/infrastructure/attendance/courses";
import { LocalAttendanceQrEncoder } from "@/infrastructure/attendance/qr";
import { CryptoAttendanceTokens } from "@/infrastructure/attendance/tokens";
import { PostgresAttendanceUnitOfWork } from "@/infrastructure/attendance/unit-of-work";
import { PostgresAttendanceRecords } from "@/infrastructure/db/repositories/attendance/repository";
import { PostgresRateLimiter } from "@/infrastructure/db/repositories/identity/rate-limiter";
import { openStudentTestData } from "./student-e2e-data";
import { openTeacherTestData } from "./teacher-e2e-data";

export function attendanceLessonTime(now: Date) {
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const duration = 90 * 60;
  const desired = Math.floor((hour * 60 + minute - 20) / 15) * 15 * 60;
  const start = Math.max(0, Math.min(24 * 60 * 60 - 1 - duration, desired));
  const time = (seconds: number) =>
    [
      Math.floor(seconds / 3600),
      Math.floor((seconds % 3600) / 60),
      seconds % 60,
    ]
      .map((value) => String(value).padStart(2, "0"))
      .join(":");
  return { startsAt: time(start), endsAt: time(start + duration) };
}

export async function openAttendanceTestData(
  options: {
    studentNames?: readonly [string, string, string];
    teacherName?: string;
    groupTitle?: string;
    lessonTime?: "around-now" | { startsAt: string; endsAt: string };
  } = {},
) {
  const teacher = await openTeacherTestData({
    fullName: options.teacherName,
    groupTitle: options.groupTitle,
  });
  const students: Awaited<ReturnType<typeof openStudentTestData>>[] = [];
  try {
    for (let i = 0; i < 3; i++)
      students.push(await openStudentTestData("anna"));
    const [student, unmarked, excused] = students;
    if (!student || !unmarked || !excused)
      throw new Error("Не созданы временные студенты.");
    const now = new Date();
    const date = moscowDate(now);
    const selectedTime =
      options.lessonTime === "around-now"
        ? attendanceLessonTime(now)
        : options.lessonTime;
    const startsAt = selectedTime?.startsAt ?? "00:00:00";
    const endsAt = selectedTime?.endsAt ?? "23:59:59";
    await teacher.sql`update schedule_slots set starts_at = ${startsAt}, ends_at = ${endsAt} where id = ${teacher.slotId}`;
    if (options.lessonTime === "around-now")
      await teacher.sql`update schedule_slots set weekday = ${weekday(date)} where id = ${teacher.slotId}`;
    const names = options.studentNames ?? [
      "Студент отметки",
      "Студент без отметки",
      "Участник конкурса",
    ];
    for (const [index, value] of students.entries()) {
      await teacher.sql`update students set group_id = ${teacher.groupId}, full_name = ${names[index] ?? "Учебный студент"} where id = ${value.actor.studentId}`;
    }
    const key = { slotId: teacher.slotId, occurrenceDate: date };
    const path = `/teacher/attendance/${key.slotId}/${key.occurrenceDate}`;
    return {
      teacher,
      student,
      unmarked,
      excused,
      key,
      path,
      lessonTime: {
        startsAt: atMoscow(date, startsAt),
        endsAt: atMoscow(date, endsAt),
      },
      async close() {
        try {
          for (const value of [teacher, ...students])
            await teacher.sql`delete from login_attempts where key like ${`attendance:%:${value.actor.userId}%`}`;
          for (const value of students) await value.close();
        } finally {
          await teacher.close();
        }
      },
    };
  } catch (error) {
    for (const student of students) await student.close();
    await teacher.close();
    throw error;
  }
}
export type AttendanceTestData = Awaited<
  ReturnType<typeof openAttendanceTestData>
>;
export function attendanceServices(
  f: AttendanceTestData,
  clock: Clock,
  basePath = "",
) {
  const { sql, ids } = f.teacher;
  const records = new PostgresAttendanceRecords(() => sql, ids);
  const uow = new PostgresAttendanceUnitOfWork(
    () => sql,
    ids,
    (transaction) => new PostgresAttendanceRecords(() => transaction, ids),
  );
  const tokens = new CryptoAttendanceTokens();
  const limiter = new PostgresRateLimiter(() => sql, clock, ids);
  return {
    records,
    uow,
    tokens,
    issue: new IssueAttendanceCode(
      uow,
      clock,
      tokens,
      new LocalAttendanceQrEncoder(),
      limiter,
      () => "https://pulse.example",
      () => basePath,
    ),
    preview: new GetAttendanceConfirmation(uow, tokens, clock),
    mark: new MarkAttendance(uow, tokens, clock, limiter),
    close: new CloseTeacherAttendance(uow, clock, limiter, tokens),
    roster: new GetTeacherAttendance(uow, clock),
    summary: new GetMyAttendance(
      records,
      new PostgresAttendanceCourses(() => sql),
    ),
  };
}
