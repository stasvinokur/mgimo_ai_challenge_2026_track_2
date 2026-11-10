import type {
  PickupBookingRecord,
  PickupBookingStatus,
  PickupRepository,
} from "@/application/requests/pickup-ports";
import { ConflictError } from "@/application/shared/errors";
import type { FakeRequests } from "./requests";

export class FakePickup implements PickupRepository {
  bookings: PickupBookingRecord[] = [];
  lockedDays: { windowId: string; day: string }[][] = [];
  windows = [
    {
      id: "00000000-0000-7000-8000-000000000091",
      facultyId: "fmo",
      title: "Окно 1",
      opensAt: "09:00:00",
      closesAt: "17:00:00",
    },
    {
      id: "00000000-0000-7000-8000-000000000092",
      facultyId: "imp",
      title: "Окно 2",
      opensAt: "09:00:00",
      closesAt: "17:00:00",
    },
  ];
  constructor(private readonly requests: FakeRequests) {}
  active(row: PickupBookingRecord) {
    return ["booked", "called"].includes(row.status);
  }
  async listWindowsForFaculty(facultyId: string) {
    return this.windows.filter((w) => w.facultyId === facultyId);
  }
  async findWindowForFaculty(id: string, facultyId: string) {
    return (
      this.windows.find((w) => w.id === id && w.facultyId === facultyId) ?? null
    );
  }
  async listOccupiedSlots(id: string, from: string, to: string) {
    return this.bookings
      .filter(
        (b) =>
          b.windowId === id &&
          this.active(b) &&
          b.slotStartsAt >= from &&
          b.slotStartsAt < to,
      )
      .map((b) => b.slotStartsAt);
  }
  async listActiveForStudent(studentId: string) {
    return this.bookings.filter(
      (b) =>
        this.active(b) &&
        this.requests.records.some(
          (r) => r.id === b.requestId && r.studentId === studentId,
        ),
    );
  }
  async findActiveForRequestForStudent(id: string, studentId: string) {
    return structuredClone(
      (await this.listActiveForStudent(studentId)).find(
        (b) => b.requestId === id,
      ) ?? null,
    );
  }
  async findByIdForStudent(id: string, studentId: string) {
    return structuredClone(
      this.bookings.find(
        (b) =>
          b.id === id &&
          this.requests.records.some(
            (r) => r.id === b.requestId && r.studentId === studentId,
          ),
      ) ?? null,
    );
  }
  async findByIdForFaculties(id: string, facultyIds: readonly string[]) {
    return structuredClone(
      this.bookings.find(
        (b) =>
          b.id === id &&
          this.requests.records.some(
            (r) => r.id === b.requestId && facultyIds.includes(r.facultyId),
          ),
      ) ?? null,
    );
  }
  async listForFaculties(
    facultyIds: readonly string[],
    from: string,
    to: string,
  ) {
    return this.bookings
      .filter(
        (b) =>
          b.slotStartsAt >= from &&
          b.slotStartsAt < to &&
          this.requests.records.some(
            (r) => r.id === b.requestId && facultyIds.includes(r.facultyId),
          ),
      )
      .sort((a, b) => a.slotStartsAt.localeCompare(b.slotStartsAt));
  }
  async nextTicketNo() {
    return `Б-${String(this.bookings.length + 1).padStart(3, "0")}`;
  }
  async lockTicketDays(keys: readonly { windowId: string; day: string }[]) {
    this.lockedDays.push(structuredClone([...keys]));
  }
  async insert(row: PickupBookingRecord) {
    if (
      this.bookings.some(
        (b) =>
          this.active(b) &&
          (b.requestId === row.requestId ||
            (b.windowId === row.windowId &&
              b.slotStartsAt === row.slotStartsAt)),
      )
    )
      throw new ConflictError();
    this.bookings.push(structuredClone(row));
  }
  async setStatus(
    id: string,
    status: PickupBookingStatus,
    expected: PickupBookingStatus,
  ) {
    const row = this.bookings.find((b) => b.id === id && b.status === expected);
    if (!row) throw new ConflictError();
    row.status = status;
  }
  async serveForRequest(id: string) {
    for (const b of this.bookings)
      if (b.requestId === id && this.active(b)) b.status = "served";
  }
}
