import { EVENT_RELEASE_TYPE } from "./event-release";

export type RequestKind = "certificate" | "event_release" | "appeal";

export function getRequestKind(type: {
  code: string;
  isCertificate: boolean;
}): RequestKind {
  if (type.code === EVENT_RELEASE_TYPE) return "event_release";
  return type.isCertificate ? "certificate" : "appeal";
}
