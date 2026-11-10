export interface LessonKey {
  slotId: string;
  occurrenceDate: string;
}

export type AttendanceStatus = "present" | "excused" | "absent";
export type AttendanceSource = "qr" | "excuse" | "demo";

export interface AttendanceRecord extends LessonKey {
  id: string;
  status: AttendanceStatus;
  source: AttendanceSource;
  sourceKey: string;
  reason: string | null;
  markedAt: string;
}
