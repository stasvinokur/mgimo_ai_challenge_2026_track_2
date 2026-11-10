import { EVENT_RELEASE_TYPE } from "@/domain/requests/event-release";
import { getSlaIndicator } from "@/domain/requests/sla-policy";
import type { RequestRecord, RequestTypeRecord } from "./ports";
import { requestFields } from "./schemas";

export type { RequestStatus } from "@/domain/requests/request-flow";
export {
  getRequestKind,
  type RequestKind,
} from "@/domain/requests/request-kind";
export type { RequestEventRecord, RequestField } from "./ports";

export const requestLabels = {
  draft: "Черновик",
  submitted: "Подана",
  accepted: "Принята",
  in_progress: "В работе",
  needs_info: "Нужна информация",
  ready: "Готова",
  issued: "Выдана",
  rejected: "Отклонена",
  cancelled: "Отменена",
} as const;

export function typeDto(type: RequestTypeRecord) {
  const { fieldsSchema, ...rest } = type;
  // Earlier seeded event types already keep the intended order in required.
  const displaySchema =
    type.code === EVENT_RELEASE_TYPE && fieldsSchema.fieldOrder === undefined
      ? { ...fieldsSchema, fieldOrder: fieldsSchema.required }
      : fieldsSchema;
  return { ...rest, fields: requestFields(displaySchema) };
}
export type RequestTypeDto = ReturnType<typeof typeDto>;

export function requestDto(
  record: RequestRecord,
  type: RequestTypeRecord,
  now: Date,
) {
  return {
    id: record.id,
    publicNo: record.status === "draft" ? null : record.publicNo,
    type: typeDto(type),
    payload: record.payload,
    status: record.status,
    assignee: record.assignee,
    submittedAt: record.submittedAt,
    dueAt: record.dueAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    sla:
      record.dueAt &&
      !["ready", "issued", "cancelled", "rejected"].includes(record.status)
        ? getSlaIndicator(new Date(record.dueAt), now)
        : null,
  };
}
export type RequestDto = ReturnType<typeof requestDto>;
