"use client";

import type { RequestDto, RequestStatus } from "@/application/requests/dto";
import { requestsMessages } from "@/ui/i18n/dictionaries/requests";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { StatusBadge } from "@/ui/primitives/status-badge";

const tones = {
  draft: "neutral",
  submitted: "info",
  accepted: "info",
  in_progress: "info",
  needs_info: "warning",
  ready: "success",
  issued: "success",
  rejected: "danger",
  cancelled: "neutral",
} as const;
export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const language = useLanguage();
  return (
    <StatusBadge tone={tones[status]}>
      {t(language, requestsMessages, status)}
    </StatusBadge>
  );
}
export function RequestSlaBadge({ sla }: { sla: RequestDto["sla"] }) {
  const language = useLanguage();
  if (!sla) return null;
  return (
    <StatusBadge
      tone={
        sla === "overdue" ? "danger" : sla === "soon" ? "warning" : "neutral"
      }
    >
      {t(
        language,
        requestsMessages,
        sla === "overdue"
          ? "sla_overdue"
          : sla === "soon"
            ? "sla_soon"
            : "sla_on_time",
      )}
    </StatusBadge>
  );
}
