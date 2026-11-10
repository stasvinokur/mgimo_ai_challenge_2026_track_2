import { describe, expect, it } from "vitest";
import type { StaffQueueCardDto } from "@/application/staff/dto";
import {
  deadlineText,
  queueCounts,
  queuePulse,
  queueSlaHref,
} from "@/ui/staff/queue-presentation";

function card(
  id: string,
  sla: StaffQueueCardDto["sla"],
  status: StaffQueueCardDto["status"] = "submitted",
): StaffQueueCardDto {
  return {
    id,
    sla,
    status,
    publicNo: `З-2026-${id}`,
    dueAt: "2026-11-04T21:30:00.000Z",
    submittedAt: "2026-11-01T09:00:00.000Z",
    type: { code: "enrollment", title: "Справка об обучении" },
    student: { fullName: "Учебный студент", group: "ДЕМО-1" },
    assignee: null,
    actions: [],
  };
}

describe("подача очереди сотрудника", () => {
  it("считает сроки и ожидающих студента независимо, только по переданным карточкам", () => {
    const requests = [
      card("1", "overdue"),
      card("2", "soon", "needs_info"),
      card("3", "on_time", "needs_info"),
      card("4", null, "ready"),
    ];
    expect(queueCounts(requests)).toEqual({
      overdue: 1,
      soon: 1,
      on_time: 1,
      needs_info: 2,
    });
    expect(
      queueCounts(requests.filter((request) => request.sla === "soon")),
    ).toEqual({ overdue: 0, soon: 1, on_time: 0, needs_info: 1 });
    expect(queueCounts([])).toEqual({
      overdue: 0,
      soon: 0,
      on_time: 0,
      needs_info: 0,
    });
  });

  it("при завершении заявки убирает её из активных сроков", () => {
    expect(queueCounts([card("1", "overdue", "in_progress")]).overdue).toBe(1);
    expect(queueCounts([card("1", null, "ready")]).overdue).toBe(0);
  });

  it.each(["all", "overdue", "soon", "on_time"] as const)(
    "ссылка %s сохраняет все остальные фильтры",
    (sla) => {
      const filters = {
        type: "enrollment",
        scope: "mine" as const,
        q: "З-2026-000001",
        sla: "all" as const,
      };
      const url = new URL(queueSlaHref(filters, sla), "https://pulse.test");
      expect(url.pathname).toBe("/staff/requests");
      expect(Object.fromEntries(url.searchParams)).toEqual({ ...filters, sla });
      expect(filters.sla).toBe("all");
    },
  );

  it.each([
    ["overdue", "Просрочено · срок 5 ноября"],
    ["soon", "Срок скоро · до 5 ноября"],
    ["on_time", "В срок · до 5 ноября"],
    [null, "Срок 5 ноября"],
  ] as const)("объединяет %s и дату по Москве в один текст", (sla, text) => {
    expect(deadlineText(card("1", sla))).toBe(text);
  });

  it("не выдумывает дату, когда срок ещё не назначен", () => {
    expect(deadlineText({ sla: null, dueAt: null })).toBe("Срок уточняется");
  });

  it("пульс помечает пики именно просроченных карточек, включая крайние", () => {
    const requests = [
      card("1", "overdue"),
      card("2", "on_time"),
      card("3", "overdue"),
    ];
    const pulse = queuePulse(requests);
    expect(pulse.overdue.map(({ id }) => id)).toEqual(["1", "3"]);
    for (const peak of pulse.overdue) {
      expect(peak.y).toBe(16);
      expect(pulse.points).toContainEqual({ x: peak.x, y: peak.y });
    }
    expect(pulse.overdue[0]?.x).toBeLessThan(pulse.overdue[1]?.x ?? 0);
    expect(queuePulse([]).overdue).toEqual([]);
    expect(queuePulse([]).points).toHaveLength(2);
  });
});
