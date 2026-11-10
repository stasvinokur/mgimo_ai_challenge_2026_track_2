import type {
  AttendanceStatus,
  LessonKey,
} from "@/domain/attendance/attendance";
import type { ScheduleData } from "@/domain/schedule/schedule";
import type { AuditLog } from "../ports/audit-log";
import type {
  RequestEventRecord,
  RequestRecord,
  RequestTransaction,
  RequestTypeRecord,
} from "../requests/ports";

export interface StaffRequestRecord {
  request: RequestRecord;
  assigneeStaffId: string | null;
  student: { fullName: string; group: string; faculty: string };
}
export interface StaffAuditRecord {
  id: string;
  action: string;
  at: string;
  staffName: string;
}
export interface StaffEventContext {
  schedule: ScheduleData;
  records: (LessonKey & { status: AttendanceStatus })[];
}
export interface StaffRequestRepository {
  isDemoUser(userId: string): Promise<boolean>;
  findEventContextForFaculties(
    id: string,
    facultyIds: readonly string[],
  ): Promise<StaffEventContext | null>;
  listTypes(): Promise<RequestTypeRecord[]>;
  listForFaculties(
    facultyIds: readonly string[],
    completedSince: string,
  ): Promise<StaffRequestRecord[]>;
  findByIdForFaculties(
    id: string,
    facultyIds: readonly string[],
  ): Promise<StaffRequestRecord | null>;
  listEventsForFaculties(
    id: string,
    facultyIds: readonly string[],
  ): Promise<RequestEventRecord[]>;
  listAuditForFaculties(
    id: string,
    facultyIds: readonly string[],
  ): Promise<StaffAuditRecord[]>;
}
export interface StaffTransaction extends RequestTransaction {
  audit: AuditLog;
}
