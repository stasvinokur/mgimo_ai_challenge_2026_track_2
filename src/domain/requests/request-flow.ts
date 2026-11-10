import {
  ConflictError,
  ForbiddenError,
  ValidationError,
} from "../shared/errors";

export const requestStatuses = [
  "draft",
  "submitted",
  "accepted",
  "in_progress",
  "needs_info",
  "ready",
  "issued",
  "rejected",
  "cancelled",
] as const;
export type RequestStatus = (typeof requestStatuses)[number];
export type RequestTarget = RequestStatus | "deleted";

const transitions: Record<
  "student" | "staff",
  Partial<Record<RequestStatus, readonly RequestTarget[]>>
> = {
  student: {
    draft: ["submitted", "deleted"],
    submitted: ["cancelled"],
    needs_info: ["in_progress"],
  },
  staff: {
    submitted: ["accepted", "rejected"],
    accepted: ["in_progress", "rejected"],
    in_progress: ["needs_info", "ready", "rejected"],
    ready: ["issued"],
  },
};

export function transitionRequest(input: {
  from: RequestStatus;
  to: RequestTarget;
  role: "student" | "staff";
  comment?: string;
  payloadValid?: boolean;
}) {
  if (!transitions[input.role][input.from]?.includes(input.to)) {
    if (
      transitions[input.role === "student" ? "staff" : "student"][
        input.from
      ]?.includes(input.to)
    )
      throw new ForbiddenError();
    throw new ConflictError();
  }
  const comment = input.comment?.trim() || null;
  if (
    (input.to === "needs_info" ||
      input.to === "rejected" ||
      input.from === "needs_info") &&
    !comment
  ) {
    throw new ValidationError({ comment: ["Добавьте комментарий."] });
  }
  if (input.to === "submitted" && !input.payloadValid)
    throw new ValidationError({
      payload: ["Заполните обязательные поля заявки."],
    });
  return {
    status: input.to,
    event: { fromStatus: input.from, toStatus: input.to, comment },
  };
}
