"use client";

import type { RequestStatus } from "@/application/requests/dto";
import { requestsMessages } from "@/ui/i18n/dictionaries/requests";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { StageBar } from "@/ui/primitives/stage-bar";

const stages: Record<RequestStatus, number> = {
  draft: 0,
  submitted: 1,
  accepted: 2,
  in_progress: 3,
  needs_info: 3,
  ready: 4,
  issued: 5,
  rejected: 0,
  cancelled: 0,
};

export function RequestStageBar({ status }: { status: RequestStatus }) {
  const language = useLanguage();
  if (status === "rejected" || status === "cancelled") return null;
  return (
    <div
      role="img"
      aria-label={t(language, requestsMessages, "stageProgress", {
        current: stages[status],
        total: 5,
      })}
    >
      <div aria-hidden="true">
        <StageBar
          total={5}
          current={stages[status]}
          tone={
            status === "needs_info"
              ? "warning"
              : status === "ready" || status === "issued"
                ? "success"
                : "info"
          }
        />
      </div>
    </div>
  );
}
