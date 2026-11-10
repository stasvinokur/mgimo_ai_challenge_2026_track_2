import type { AttendanceRecords } from "@/application/attendance/ports";
import type {
  EventReleaseDependencies,
  RequestTransaction,
} from "@/application/requests/ports";
import type { AttendanceRecord } from "@/domain/attendance/attendance";
import { requestFixtures } from "../../scripts/fixtures/requests";
import { fixtureContext } from "../../scripts/fixtures/shared";
import { FakeClock } from "./clock";
import { SequentialIdGenerator } from "./id-generator";
import { FakeRequests } from "./requests";

const catalogEventType = requestFixtures(
  fixtureContext(
    new FakeClock("2026-11-05T09:00:00Z"),
    new SequentialIdGenerator(),
  ),
).requestTypes.find((type) => type.code === "event_release");
export const eventType = (() => {
  if (!catalogEventType) throw new Error("Нет типа освобождения.");
  return catalogEventType;
})();
export const eventPayload = {
  eventName: "Хакатон «Учебный импульс»",
  organizer: "Учебный центр «Идея»",
  dateFrom: "2026-11-02",
  dateTo: "2026-11-03",
  eventFormat: "Очно",
  confirmation: "Приглашение участнику учебного хакатона",
};

export class FakeEventAttendance
  implements
    Pick<AttendanceRecords, "markExcusedForStudent" | "awardActivityForStudent">
{
  records = new Map<string, AttendanceRecord>();
  points = new Map<string, number>();
  owners: string[] = [];
  failAt = -1;
  calls = 0;
  async markExcusedForStudent(
    studentId: string,
    lesson: Parameters<AttendanceRecords["markExcusedForStudent"]>[1],
    input: Parameters<AttendanceRecords["markExcusedForStudent"]>[2],
  ) {
    if (++this.calls === this.failAt) throw new Error("Тестовый отказ отметки");
    this.owners.push(studentId);
    const key = `${studentId}:${lesson.slotId}:${lesson.occurrenceDate}`;
    const current = this.records.get(key);
    if (
      current &&
      (current.status === "present" || current.sourceKey === input.sourceKey)
    )
      return current;
    const result: AttendanceRecord = {
      id: key,
      ...lesson,
      status: "excused",
      source: "excuse",
      sourceKey: input.sourceKey,
      reason: input.reason,
      markedAt: input.markedAt,
    };
    this.records.set(key, result);
    return result;
  }
  async awardActivityForStudent(
    studentId: string,
    input: Parameters<AttendanceRecords["awardActivityForStudent"]>[1],
  ) {
    this.points.set(`${studentId}:${input.sourceKey}`, input.points);
  }
  async markPresentForStudent(): Promise<AttendanceRecord> {
    throw new Error("Не используется");
  }
  async listForStudent() {
    return {
      records: [...this.records.values()],
      activityPoints: [...this.points.values()].reduce((a, b) => a + b, 0),
    };
  }
  async listForTeacherLesson() {
    return [];
  }
}

export class FakeEventRequests extends FakeRequests {
  constructor(
    private readonly eventRelease: EventReleaseDependencies & {
      attendance: FakeEventAttendance;
    },
  ) {
    super();
  }

  override async run<T>(work: (tx: RequestTransaction) => Promise<T>) {
    const attendance = this.eventRelease.attendance;
    const snapshot = structuredClone({
      records: attendance.records,
      points: attendance.points,
      owners: attendance.owners,
    });
    try {
      return await super.run((tx) =>
        work({ ...tx, eventRelease: this.eventRelease }),
      );
    } catch (error) {
      Object.assign(attendance, snapshot);
      throw error;
    }
  }
}
