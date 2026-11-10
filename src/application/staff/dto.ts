import {
  type RequestStatus,
  transitionRequest,
} from "@/domain/requests/request-flow";
import { requestDto } from "../requests/dto";
import type { RequestTypeRecord } from "../requests/ports";
import { ConflictError, ForbiddenError } from "../shared/errors";
import type { StaffRequestRecord } from "./ports";

export { staffCommentOptions } from "@/domain/requests/staff-comments";

export const staffActions = {
  accepted: { label: "Принять", code: "request.accept", comment: false },
  in_progress: { label: "В работу", code: "request.start", comment: false },
  needs_info: {
    label: "Нужна информация",
    code: "request.needs_info",
    comment: true,
  },
  ready: { label: "Готова", code: "request.ready", comment: false },
  issued: { label: "Выдать", code: "request.issue", comment: false },
  rejected: { label: "Отклонить", code: "request.reject", comment: true },
} as const;
export type StaffTarget = keyof typeof staffActions;

export function allowedStaffActions(from: RequestStatus): StaffTarget[] {
  return (Object.keys(staffActions) as StaffTarget[]).filter((to) => {
    try {
      transitionRequest({
        from,
        to,
        role: "staff",
        comment: "Проверка доступности",
      });
      return true;
    } catch (error) {
      if (error instanceof ConflictError || error instanceof ForbiddenError)
        return false;
      throw error;
    }
  });
}

export function staffRequestDto(
  row: StaffRequestRecord,
  type: RequestTypeRecord,
  now: Date,
) {
  return {
    ...requestDto(row.request, type, now),
    student: row.student,
    actions: allowedStaffActions(row.request.status),
  };
}
export type StaffRequestDto = ReturnType<typeof staffRequestDto>;

export function staffQueueCardDto(
  row: StaffRequestRecord,
  type: RequestTypeRecord,
  now: Date,
) {
  const dto = requestDto(row.request, type, now);
  return {
    id: dto.id,
    publicNo: dto.publicNo,
    type: { code: type.code, title: type.title },
    student: { fullName: row.student.fullName, group: row.student.group },
    status: dto.status,
    submittedAt: dto.submittedAt,
    dueAt: dto.dueAt,
    sla: dto.sla,
    assignee: dto.assignee,
    actions: allowedStaffActions(dto.status),
  };
}
export type StaffQueueCardDto = ReturnType<typeof staffQueueCardDto>;
