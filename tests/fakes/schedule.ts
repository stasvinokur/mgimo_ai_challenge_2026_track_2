import type { Actor } from "@/application/ports/actor";
import type {
  CalendarTokenStore,
  CalendarTokens,
  ScheduleRepository,
} from "@/application/schedule/ports";
import type {
  ScheduleChange,
  ScheduleData,
  ScheduleSlot,
} from "@/domain/schedule/schedule";

export const anna: Actor = {
  kind: "student",
  userId: "anna-user",
  studentId: "anna",
  facultyId: "fmo",
};
export const timur: Actor = {
  kind: "student",
  userId: "timur-user",
  studentId: "timur",
  facultyId: "imp",
};
export const staff: Actor = {
  kind: "staff",
  userId: "staff-user",
  staffId: "staff",
  facultyIds: ["fmo"],
};

export const slot: ScheduleSlot = {
  id: "slot-anna",
  course: "История международных отношений",
  teacher: "Светлана Рощина",
  room: "405",
  weekday: 1,
  startsAt: "09:00:00",
  endsAt: "10:30:00",
  kind: "lecture",
  weekParity: "any",
};

export function change(
  overrides: Partial<ScheduleChange> = {},
): ScheduleChange {
  return {
    id: "move",
    slotId: slot.id,
    date: "2026-11-02",
    kind: "moved",
    oldStartsAt: null,
    oldEndsAt: null,
    oldRoom: null,
    oldTeacher: null,
    newDate: "2026-11-02",
    newStartsAt: "13:00:00",
    newEndsAt: "14:30:00",
    newRoom: "312",
    newTeacher: null,
    reason: "Учебная встреча перенесена.",
    createdAt: "2026-11-01T12:00:00.000Z",
    ...overrides,
  };
}

export function scheduleData(
  overrides: Partial<ScheduleData> = {},
): ScheduleData {
  return {
    group: "МО-ДЕМО-2",
    slots: [structuredClone(slot)],
    changes: [],
    ...overrides,
  };
}

export class FakeScheduleRepository implements ScheduleRepository {
  records = new Map<string, ScheduleData>([
    ["anna", scheduleData({ changes: [change()] })],
    [
      "timur",
      scheduleData({
        group: "ИМП-ДЕМО-1",
        slots: [{ ...slot, id: "slot-timur", course: "Основы маркетинга" }],
      }),
    ],
  ]);
  async findForStudent(studentId: string) {
    return structuredClone(this.records.get(studentId) ?? null);
  }
}

export class FakeCalendarTokenStore implements CalendarTokenStore {
  records = new Map<string, string>();
  async replaceForStudent(studentId: string, _id: string, hash: string) {
    this.records.set(studentId, hash);
  }
  async findStudentByHash(hash: string) {
    return [...this.records].find(([, value]) => value === hash)?.[0] ?? null;
  }
}

export class FakeCalendarTokens implements CalendarTokens {
  private counter = 0;
  generate() {
    return String(++this.counter).padStart(43, "a");
  }
  hash(token: string) {
    return `hash:${token}`;
  }
}
