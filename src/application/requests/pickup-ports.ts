export type PickupBookingStatus =
  | "booked"
  | "called"
  | "served"
  | "cancelled"
  | "no_show";

export interface PickupWindowRecord {
  id: string;
  facultyId: string;
  title: string;
  opensAt: string;
  closesAt: string;
}

export interface PickupBookingRecord {
  id: string;
  userId: string;
  requestId: string;
  windowId: string;
  windowTitle: string;
  slotStartsAt: string;
  ticketNo: string;
  status: PickupBookingStatus;
  createdAt: string;
}

export interface PickupRepository {
  listActiveForStudent(studentId: string): Promise<PickupBookingRecord[]>;
  listWindowsForFaculty(facultyId: string): Promise<PickupWindowRecord[]>;
  findWindowForFaculty(
    id: string,
    facultyId: string,
  ): Promise<PickupWindowRecord | null>;
  listOccupiedSlots(
    windowId: string,
    from: string,
    to: string,
  ): Promise<string[]>;
  findActiveForRequestForStudent(
    requestId: string,
    studentId: string,
    lock?: boolean,
  ): Promise<PickupBookingRecord | null>;
  findByIdForStudent(
    id: string,
    studentId: string,
    lock?: boolean,
  ): Promise<PickupBookingRecord | null>;
  findByIdForFaculties(
    id: string,
    facultyIds: readonly string[],
    lock?: boolean,
  ): Promise<PickupBookingRecord | null>;
  listForFaculties(
    facultyIds: readonly string[],
    from: string,
    to: string,
  ): Promise<PickupBookingRecord[]>;
  lockTicketDays(
    keys: readonly { windowId: string; day: string }[],
  ): Promise<void>;
  nextTicketNo(windowId: string, day: string): Promise<string>;
  insert(booking: PickupBookingRecord): Promise<void>;
  setStatus(
    id: string,
    status: PickupBookingStatus,
    expectedStatus: PickupBookingStatus,
  ): Promise<void>;
  serveForRequest(requestId: string): Promise<void>;
}
