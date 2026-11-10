import { AlertCircle } from "lucide-react";
import type { StaffQueueCardDto } from "@/application/staff/dto";
import { cn } from "@/ui/primitives/utils";
import { deadlineText } from "./queue-presentation";

export function StaffDeadline({
  request,
}: {
  request: Pick<StaffQueueCardDto, "sla" | "dueAt">;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold",
        request.sla === "overdue"
          ? "status-danger"
          : request.sla === "soon"
            ? "status-warning"
            : request.sla === "on_time"
              ? "status-success"
              : "bg-muted text-muted-foreground",
      )}
    >
      {request.sla === "overdue" && (
        <AlertCircle className="size-3 shrink-0" aria-hidden="true" />
      )}
      <span>{deadlineText(request)}</span>
    </span>
  );
}
