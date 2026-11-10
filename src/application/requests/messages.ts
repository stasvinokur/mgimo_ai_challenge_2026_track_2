import type { RequestStatus } from "@/domain/requests/request-flow";
import { getRequestKind } from "@/domain/requests/request-kind";

const statusMessages = {
  draft: "explanationDraft",
  submitted: "explanationSubmitted",
  accepted: "explanationAccepted",
  in_progress: "explanationInProgress",
  needs_info: "explanationNeedsInfo",
  ready: "explanationReady",
  issued: "explanationIssued",
  rejected: "explanationRejected",
  cancelled: "explanationCancelled",
} as const satisfies Record<RequestStatus, string>;

const kindMessages = {
  certificate: {},
  event_release: {
    accepted: "explanationEventAccepted",
    in_progress: "explanationEventInProgress",
    ready: "explanationEventReady",
    issued: "explanationEventIssued",
  },
  appeal: {
    accepted: "explanationAppealAccepted",
    in_progress: "explanationAppealInProgress",
    ready: "explanationAppealReady",
    issued: "explanationAppealIssued",
  },
} as const;

type KindMessage =
  | (typeof kindMessages.event_release)[keyof typeof kindMessages.event_release]
  | (typeof kindMessages.appeal)[keyof typeof kindMessages.appeal];

export interface RequestExplanationMessageDto {
  code: (typeof statusMessages)[RequestStatus] | KindMessage;
}

export function getRequestExplanationMessage(
  status: RequestStatus,
  type: { code: string; isCertificate: boolean },
): RequestExplanationMessageDto {
  const messages: Partial<Record<RequestStatus, KindMessage>> =
    kindMessages[getRequestKind(type)];
  return { code: messages[status] ?? statusMessages[status] };
}

export interface PickupMessageDto {
  code: "pickupBooked" | "pickupCalled";
  params: { ticketNo: string };
}

export function getPickupMessage(booking: {
  status: string;
  ticketNo: string;
}): PickupMessageDto {
  return {
    code: booking.status === "called" ? "pickupCalled" : "pickupBooked",
    params: { ticketNo: booking.ticketNo },
  };
}
