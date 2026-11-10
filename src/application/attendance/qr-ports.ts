import type { LessonKey } from "@/domain/attendance/attendance";
import type { UnitOfWork } from "../ports/unit-of-work";
import type { ScheduleRepository } from "../schedule/ports";
import type { TeacherScheduleRepository } from "../teacher/ports";
import type { AttendanceRecords } from "./ports";

export interface AttendanceCode extends LessonKey {
  teacherId: string;
  codeHash: string;
  createdAt: string;
  expiresAt: string;
}
export interface AttendanceCodes {
  issue(code: AttendanceCode): Promise<void>;
  findActive(codeHash: string, now: string): Promise<AttendanceCode | null>;
  revokeForLesson(lesson: LessonKey): Promise<void>;
}
export interface AttendanceTokens {
  generate(): string;
  hash(code: string): string;
}
export interface AttendanceQrEncoder {
  encode(url: string): Promise<string>;
}
export interface AttendanceContext {
  records: AttendanceRecords;
  codes: AttendanceCodes;
  schedule: ScheduleRepository;
  teacherSchedule: TeacherScheduleRepository;
  lockLesson(lesson: LessonKey): Promise<void>;
}
export type AttendanceUnitOfWork = UnitOfWork<AttendanceContext>;

export interface AttendanceCourses {
  listForStudent(
    studentId: string,
  ): Promise<{ slotId: string; courseId: string; title: string }[]>;
}
