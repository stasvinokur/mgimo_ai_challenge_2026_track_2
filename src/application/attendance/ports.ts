import type {
  AttendanceRecord,
  LessonKey,
} from "@/domain/attendance/attendance";

export interface AttendanceRosterEntry {
  fullName: string;
  group: string;
  status: AttendanceRecord["status"] | null;
  reason: string | null;
}

export interface AttendanceRecords {
  listRosterForTeacherLesson(
    lesson: LessonKey,
    teacherId: string,
  ): Promise<AttendanceRosterEntry[]>;
  closeForTeacherLesson(
    lesson: LessonKey,
    teacherId: string,
    markedAt: string,
  ): Promise<void>;
  markPresentForStudent(
    studentId: string,
    lesson: LessonKey,
    input: { sourceKey: string; markedAt: string },
  ): Promise<AttendanceRecord>;
  markExcusedForStudent(
    studentId: string,
    lesson: LessonKey,
    input: { sourceKey: string; reason: string; markedAt: string },
  ): Promise<AttendanceRecord>;
  awardActivityForStudent(
    studentId: string,
    input: { sourceKey: string; points: number; createdAt: string },
  ): Promise<void>;
  listForStudent(
    studentId: string,
    from: string,
    to: string,
  ): Promise<{ records: AttendanceRecord[]; activityPoints: number }>;
  listForTeacherLesson(
    lesson: LessonKey,
    teacherId: string,
  ): Promise<
    { fullName: string; group: string; status: AttendanceRecord["status"] }[]
  >;
}
