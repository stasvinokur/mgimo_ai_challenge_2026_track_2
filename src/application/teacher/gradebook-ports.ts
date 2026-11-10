import type { LessonKey } from "@/domain/attendance/attendance";
import type { ScoreReasonCode } from "@/domain/grades/score-reasons";
import type { UnitOfWork } from "../ports/unit-of-work";
import type { TeacherScheduleRepository } from "./ports";

export interface GradebookReference extends LessonKey {
  course: string;
  group: string;
}

export interface GradebookRoster {
  courseId: string;
  works: { id: string; title: string; maxScore: number }[];
  students: {
    key: string;
    fullName: string;
    group: string;
    entries: { key: string; assessmentId: string; score: number | null }[];
  }[];
}

export interface GradebookEntry {
  assessmentId: string;
  studentId: string;
  studentUserId: string | null;
  courseId: string;
  courseTitle: string;
  workTitle: string;
  maxScore: number;
  score: number | null;
}

export interface TeacherGradebooks {
  isBaseTeacherForLesson(key: LessonKey, teacherId: string): Promise<boolean>;
  listForTeacher(
    teacherId: string,
    referenceDate: string,
  ): Promise<GradebookReference[]>;
  getForTeacherLesson(
    key: LessonKey,
    teacherId: string,
  ): Promise<GradebookRoster>;
  readEntryForTeacherLesson(
    key: LessonKey,
    teacherId: string,
    entryKey: string,
  ): Promise<GradebookEntry | null>;
  findEntryForTeacherLesson(
    key: LessonKey,
    teacherId: string,
    entryKey: string,
  ): Promise<GradebookEntry | null>;
  recordChange(input: {
    entry: GradebookEntry;
    score: number;
    reason: ScoreReasonCode | null;
    changedByUserId: string;
    at: string;
    eventId: string;
    notificationId: string;
  }): Promise<void>;
}

export interface GradebookReadContext {
  books: Pick<
    TeacherGradebooks,
    | "listForTeacher"
    | "getForTeacherLesson"
    | "isBaseTeacherForLesson"
    | "readEntryForTeacherLesson"
  >;
  teacherSchedule: TeacherScheduleRepository;
}

export interface GradebookContext extends GradebookReadContext {
  books: TeacherGradebooks;
  lockLesson(key: LessonKey): Promise<void>;
  lockEntry(entryKey: string): Promise<void>;
}

export interface TeacherGradebookUnitOfWork
  extends UnitOfWork<GradebookContext> {
  read<T>(work: (context: GradebookReadContext) => Promise<T>): Promise<T>;
}
