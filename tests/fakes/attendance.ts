import type {
  AttendanceRecords,
  AttendanceRosterEntry,
} from "@/application/attendance/ports";
import type {
  AttendanceCode,
  AttendanceCodes,
  AttendanceContext,
  AttendanceTokens,
  AttendanceUnitOfWork,
} from "@/application/attendance/qr-ports";
import type {
  AttendanceRecord,
  LessonKey,
} from "@/domain/attendance/attendance";
import { buildSchedule } from "@/domain/schedule/schedule";
import { FakeScheduleRepository, scheduleData, slot } from "./schedule";
import { FakeTeacherScheduleRepository, oleg } from "./teacher";

export const attendanceKey = {
  slotId: "019b0000-0000-7000-8000-000000000035",
  occurrenceDate: "2026-11-02",
};
const keyOf = (student: string, key: LessonKey) =>
  `${student}:${key.slotId}:${key.occurrenceDate}`;
export class FakeAttendanceRecords implements AttendanceRecords {
  records = new Map<string, AttendanceRecord>();
  points = new Map<string, number>();
  calls: string[] = [];
  async markPresentForStudent(
    studentId: string,
    key: LessonKey,
    input: { sourceKey: string; markedAt: string },
  ) {
    this.calls.push(studentId);
    const id = keyOf(studentId, key);
    const existing = this.records.get(id);
    if (existing?.status === "present") return existing;
    const row: AttendanceRecord = {
      ...key,
      ...input,
      id,
      status: "present",
      source: "qr",
      reason: null,
    };
    this.records.set(id, row);
    return row;
  }
  async markExcusedForStudent(
    studentId: string,
    key: LessonKey,
    input: { sourceKey: string; markedAt: string; reason: string },
  ) {
    const id = keyOf(studentId, key);
    const row: AttendanceRecord = {
      ...key,
      ...input,
      id,
      status: "excused",
      source: "excuse",
    };
    this.records.set(id, row);
    return row;
  }
  async awardActivityForStudent(
    studentId: string,
    input: { sourceKey: string; points: number },
  ) {
    this.points.set(`${studentId}:${input.sourceKey}`, input.points);
  }
  async listForStudent(studentId: string, from: string, to: string) {
    return {
      records: [...this.records.values()].filter(
        (row) =>
          row.id.startsWith(`${studentId}:`) &&
          row.occurrenceDate >= from &&
          row.occurrenceDate <= to,
      ),
      activityPoints: [...this.points]
        .filter(([key]) => key.startsWith(`${studentId}:`))
        .reduce((total, [, points]) => total + points, 0),
    };
  }
  async listForTeacherLesson(_key: LessonKey, _teacherId: string) {
    return [];
  }
  async listRosterForTeacherLesson(
    key: LessonKey,
    _teacherId: string,
  ): Promise<AttendanceRosterEntry[]> {
    const row = this.records.get(keyOf("anna", key));
    return [
      {
        fullName: "Учебный студент",
        group: "ДЕМО-1",
        status: row?.status ?? null,
        reason: row?.reason ?? null,
      },
    ];
  }
  async closeForTeacherLesson(
    key: LessonKey,
    _teacherId: string,
    markedAt: string,
  ) {
    const id = keyOf("anna", key);
    if (!this.records.has(id))
      this.records.set(id, {
        ...key,
        id,
        status: "absent",
        source: "qr",
        sourceKey: `closed:${key.slotId}:${key.occurrenceDate}`,
        markedAt,
        reason: null,
      });
  }
}
export class FakeAttendanceCodes implements AttendanceCodes {
  codes = new Map<string, AttendanceCode>();
  async issue(code: AttendanceCode) {
    this.codes.set(code.codeHash, structuredClone(code));
  }
  async findActive(hash: string, now: string) {
    const code = this.codes.get(hash);
    return code && code.createdAt <= now && code.expiresAt > now
      ? structuredClone(code)
      : null;
  }
  async revokeForLesson(key: LessonKey) {
    for (const [hash, code] of this.codes)
      if (
        code.slotId === key.slotId &&
        code.occurrenceDate === key.occurrenceDate
      )
        this.codes.delete(hash);
  }
}
export class FakeAttendanceTokens implements AttendanceTokens {
  sequence = 0;
  generate() {
    return String(++this.sequence).padStart(22, "a");
  }
  hash(code: string) {
    return `sha256:${code}`;
  }
}
export class FakeAttendanceUnitOfWork implements AttendanceUnitOfWork {
  records = new FakeAttendanceRecords();
  codes = new FakeAttendanceCodes();
  schedule = new FakeScheduleRepository();
  teacherSchedule = new FakeTeacherScheduleRepository();
  calls = 0;
  onLock: (() => Promise<void>) | null = null;
  constructor() {
    const data = scheduleData({
      slots: [{ ...slot, id: attendanceKey.slotId }],
      changes: [],
    });
    this.schedule.records.set("anna", data);
    this.teacherSchedule.lessons.set(
      oleg.teacherId,
      buildSchedule(
        data,
        attendanceKey.occurrenceDate,
        attendanceKey.occurrenceDate,
      ).map((lesson) => ({ ...lesson, group: data.group })),
    );
  }
  async run<T>(work: (ctx: AttendanceContext) => Promise<T>): Promise<T> {
    this.calls++;
    const records = structuredClone(this.records.records),
      points = structuredClone(this.records.points),
      codes = structuredClone(this.codes.codes);
    try {
      return await work({
        ...this,
        lockLesson: async () => {
          await this.onLock?.();
        },
      });
    } catch (error) {
      this.records.records = records;
      this.records.points = points;
      this.codes.codes = codes;
      throw error;
    }
  }
}
