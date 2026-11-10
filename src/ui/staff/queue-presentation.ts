import type { StaffQueueDto } from "@/application/staff/queries";
import { layoutDayTimeline } from "@/ui/primitives/day-timeline-layout";

export function queueCounts(requests: StaffQueueDto["requests"]) {
  return {
    overdue: requests.filter((request) => request.sla === "overdue").length,
    soon: requests.filter((request) => request.sla === "soon").length,
    on_time: requests.filter((request) => request.sla === "on_time").length,
    needs_info: requests.filter((request) => request.status === "needs_info")
      .length,
  };
}

export function queueSlaHref(
  filters: StaffQueueDto["filters"],
  sla: StaffQueueDto["filters"]["sla"],
) {
  return `/staff/requests?${new URLSearchParams({ ...filters, sla })}`;
}

export function queuePulse(requests: StaffQueueDto["requests"]) {
  // Queue positions reuse the timeline geometry without representing time.
  const layout = layoutDayTimeline({
    intervals: requests.map((request, index) => ({
      start: index * 2 + 1,
      end: index * 2 + 2,
      title: request.id,
    })),
    dayStart: 0,
    dayEnd: Math.max(2, requests.length * 2 + 1),
    now: Number.NaN,
    width: 240,
  });
  return {
    points: layout.points,
    overdue: requests.flatMap((request, index) => {
      const peak = layout.points[index * 6 + 4];
      return request.sla === "overdue" && peak
        ? [{ ...peak, id: request.id }]
        : [];
    }),
  };
}

const deadlineDate = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "Europe/Moscow",
});

export function deadlineText({
  sla,
  dueAt,
}: Pick<StaffQueueDto["requests"][number], "sla" | "dueAt">) {
  const date = dueAt ? deadlineDate.format(new Date(dueAt)) : null;
  if (sla === "overdue") return `Просрочено${date ? ` · срок ${date}` : ""}`;
  if (sla === "soon") return `Срок скоро${date ? ` · до ${date}` : ""}`;
  if (sla === "on_time") return `В срок${date ? ` · до ${date}` : ""}`;
  return date ? `Срок ${date}` : "Срок уточняется";
}
