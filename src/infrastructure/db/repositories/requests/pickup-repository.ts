import type { Sql } from "postgres";
import type {
  PickupBookingRecord,
  PickupBookingStatus,
  PickupRepository,
  PickupWindowRecord,
} from "@/application/requests/pickup-ports";
import { ConflictError } from "@/domain/shared/errors";

type BookingRow = Omit<PickupBookingRecord, "slotStartsAt" | "createdAt"> & {
  slotStartsAt: Date;
  createdAt: Date;
};

function booking(row: BookingRow): PickupBookingRecord {
  return {
    ...row,
    slotStartsAt: row.slotStartsAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export class PostgresPickupRepository implements PickupRepository {
  constructor(private readonly database: () => Sql) {}

  async listWindowsForFaculty(facultyId: string) {
    return this.database()<PickupWindowRecord[]>`
      select id, faculty_id as "facultyId", title,
        opens_at as "opensAt", closes_at as "closesAt"
      from pickup_windows where faculty_id = ${facultyId} order by title, id`;
  }

  async findWindowForFaculty(id: string, facultyId: string) {
    const [row] = await this.database()<PickupWindowRecord[]>`
      select id, faculty_id as "facultyId", title,
        opens_at as "opensAt", closes_at as "closesAt"
      from pickup_windows where id = ${id} and faculty_id = ${facultyId}`;
    return row ?? null;
  }

  async listOccupiedSlots(windowId: string, from: string, to: string) {
    const rows = await this.database()<{ at: Date }[]>`
      select slot_starts_at as at from pickup_bookings
      where window_id = ${windowId} and slot_starts_at >= ${from}::timestamptz
        and slot_starts_at < ${to}::timestamptz and status in ('booked', 'called')
      order by slot_starts_at, id`;
    return rows.map((row) => row.at.toISOString());
  }

  private rows() {
    return this.database()`select b.id, b.user_id as "userId", b.request_id as "requestId",
      b.window_id as "windowId", w.title as "windowTitle", b.slot_starts_at as "slotStartsAt",
      b.ticket_no as "ticketNo", b.status, b.created_at as "createdAt"
      from pickup_bookings b join pickup_windows w on w.id = b.window_id
      join requests r on r.id = b.request_id join students s on s.id = r.student_id`;
  }

  async listActiveForStudent(studentId: string) {
    const rows = await this.database()<BookingRow[]>`${this.rows()}
      where s.id = ${studentId} and b.user_id = s.user_id
        and b.status in ('booked', 'called') order by b.slot_starts_at, b.id`;
    return rows.map(booking);
  }

  async findActiveForRequestForStudent(
    requestId: string,
    studentId: string,
    lock = false,
  ) {
    const rows = await this.database()<BookingRow[]>`${this.rows()}
      where r.id = ${requestId} and s.id = ${studentId} and b.user_id = s.user_id
        and b.status in ('booked', 'called')
      order by b.slot_starts_at, b.id ${lock ? this.database()`for update of b` : this.database()``}`;
    return rows[0] ? booking(rows[0]) : null;
  }

  async findByIdForStudent(id: string, studentId: string, lock = false) {
    const rows = await this.database()<BookingRow[]>`${this.rows()}
      where b.id = ${id} and s.id = ${studentId} and b.user_id = s.user_id
      ${lock ? this.database()`for update of b` : this.database()``}`;
    return rows[0] ? booking(rows[0]) : null;
  }

  async findByIdForFaculties(
    id: string,
    facultyIds: readonly string[],
    lock = false,
  ) {
    if (!facultyIds.length) return null;
    const rows = await this.database()<BookingRow[]>`${this.rows()}
      where b.id = ${id} and s.faculty_id = any(${[...facultyIds]}::uuid[])
        and w.faculty_id = s.faculty_id and b.user_id = s.user_id
      ${lock ? this.database()`for update of b` : this.database()``}`;
    return rows[0] ? booking(rows[0]) : null;
  }

  async listForFaculties(
    facultyIds: readonly string[],
    from: string,
    to: string,
  ) {
    if (!facultyIds.length) return [];
    const rows = await this.database()<BookingRow[]>`${this.rows()}
      where s.faculty_id = any(${[...facultyIds]}::uuid[]) and w.faculty_id = s.faculty_id
        and b.user_id = s.user_id and b.slot_starts_at >= ${from}::timestamptz
        and b.slot_starts_at < ${to}::timestamptz
      order by b.slot_starts_at, w.title, b.id`;
    return rows.map(booking);
  }

  async lockTicketDays(keys: readonly { windowId: string; day: string }[]) {
    const sql = this.database();
    const ordered = [
      ...new Set(keys.map(({ windowId, day }) => `pickup:${windowId}:${day}`)),
    ].sort();
    // Acquire all source/destination locks before cancelling any occupied slot.
    for (const key of ordered)
      await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }

  async nextTicketNo(windowId: string, day: string) {
    const sql = this.database();
    // Cancelled tickets remain in the daily sequence, so a number is never reused.
    await this.lockTicketDays([{ windowId, day }]);
    const [row] = await sql<{ next: number }[]>`
      select coalesce(max(substring(ticket_no from 3)::integer), 0) + 1 as next
      from pickup_bookings where window_id = ${windowId}
        and slot_starts_at >= (${day}::date::timestamp at time zone 'Europe/Moscow')
        and slot_starts_at < ((${day}::date + 1)::timestamp at time zone 'Europe/Moscow')`;
    return `Б-${String(row?.next ?? 1).padStart(3, "0")}`;
  }

  async insert(record: PickupBookingRecord) {
    try {
      await this.database()`insert into pickup_bookings
        (id, user_id, request_id, window_id, slot_starts_at, ticket_no, status, created_at)
        values (${record.id}, ${record.userId}, ${record.requestId}, ${record.windowId},
          ${record.slotStartsAt}::timestamptz, ${record.ticketNo}, ${record.status}, ${record.createdAt}::timestamptz)`;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      ) {
        const conflict = new ConflictError();
        conflict.message =
          "Этот слот уже занят или у заявки уже есть талон. Выберите другое время.";
        throw conflict;
      }
      throw error;
    }
  }

  async setStatus(
    id: string,
    status: PickupBookingStatus,
    expectedStatus: PickupBookingStatus,
  ) {
    const rows =
      await this.database()`update pickup_bookings set status = ${status}
      where id = ${id} and status = ${expectedStatus} returning id`;
    if (!rows.length) throw new ConflictError();
  }

  async serveForRequest(requestId: string) {
    await this.database()`update pickup_bookings set status = 'served'
      where request_id = ${requestId} and status in ('booked', 'called')`;
  }
}
