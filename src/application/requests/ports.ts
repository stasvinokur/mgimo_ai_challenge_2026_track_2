import type { RequestStatus } from "@/domain/requests/request-flow";
import type { AttendanceRecords } from "../attendance/ports";
import type { ScheduleRepository } from "../schedule/ports";
import type { StudentProfile } from "../student/ports";
import type { PickupRepository } from "./pickup-ports";

export interface RequestField {
  name: string;
  title: string;
  required: boolean;
  minLength: number;
  maxLength: number;
  format?: "date";
}
export interface RequestTypeRecord {
  code: string;
  title: string;
  description: string;
  slaWorkDays: number;
  delivery: "pdf" | "pickup";
  fieldsSchema: Record<string, unknown>;
  isCertificate: boolean;
}
export interface RequestRecord {
  id: string;
  publicNo: string;
  studentId: string;
  facultyId: string;
  studentUserId: string | null;
  typeCode: string;
  payload: Record<string, unknown>;
  status: RequestStatus;
  assignee: string | null;
  submittedAt: string | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface RequestEventRecord {
  id: string;
  requestId: string;
  fromStatus: RequestStatus | null;
  toStatus: RequestStatus;
  actorUserId: string;
  comment: string | null;
  at: string;
}
export interface RequestRepository {
  isDemoAccount(userId: string): Promise<boolean>;
  listTypes(): Promise<RequestTypeRecord[]>;
  findType(code: string): Promise<RequestTypeRecord | null>;
  findProfileForStudent(studentId: string): Promise<StudentProfile | null>;
  listForStudent(studentId: string): Promise<RequestRecord[]>;
  findOldestUnseededDraftForStudent(
    studentId: string,
    lock?: boolean,
  ): Promise<RequestRecord | null>;
  lockUsageForStudent(
    studentId: string,
    since: string,
  ): Promise<{
    openDrafts: number;
    submissions: number;
  }>;
  findByIdForStudent(
    id: string,
    studentId: string,
    lock?: boolean,
  ): Promise<RequestRecord | null>;
  findByIdForFaculties(
    id: string,
    facultyIds: readonly string[],
    lock?: boolean,
  ): Promise<RequestRecord | null>;
  listEventsForStudent(
    id: string,
    studentId: string,
  ): Promise<RequestEventRecord[]>;
  createDraft(record: RequestRecord): Promise<void>;
  save(
    record: RequestRecord,
    expected: RequestRecord,
    assigneeStaffId?: string,
  ): Promise<void>;
  deleteDraftForStudent(id: string, studentId: string): Promise<void>;
  nextPublicNo(year: number): Promise<string>;
  appendEvent(event: RequestEventRecord): Promise<void>;
}
export interface RequestNotifications {
  add(input: {
    id: string;
    userId: string;
    requestId: string;
    title: string;
    body: string;
    at: string;
  }): Promise<void>;
}
export interface RequestCertificates {
  create(input: {
    id: string;
    requestId: string;
    publicNo: string;
    at: string;
  }): Promise<void>;
}
export interface EventReleaseDependencies {
  schedule: ScheduleRepository;
  attendance: Pick<
    AttendanceRecords,
    "markExcusedForStudent" | "awardActivityForStudent"
  >;
}
export interface RequestTransaction {
  pickup?: PickupRepository;
  eventRelease?: EventReleaseDependencies;
  requests: RequestRepository;
  notifications: RequestNotifications;
  certificates: RequestCertificates;
}
