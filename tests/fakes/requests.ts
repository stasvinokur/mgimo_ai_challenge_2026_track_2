import type { UnitOfWork } from "@/application/ports/unit-of-work";
import type {
  RequestEventRecord,
  RequestRecord,
  RequestRepository,
  RequestTransaction,
  RequestTypeRecord,
} from "@/application/requests/ports";
import { ConflictError } from "@/application/shared/errors";
import { FakeStudentRepository } from "./identity";
import { FakePickup } from "./requests-pickup";

export const enrollmentType: RequestTypeRecord = {
  code: "enrollment",
  title: "Справка об обучении",
  description: "По месту требования",
  slaWorkDays: 3,
  delivery: "pdf",
  isCertificate: true,
  fieldsSchema: {
    type: "object",
    properties: {
      destination: {
        type: "string",
        title: "Место требования",
        minLength: 1,
        maxLength: 500,
      },
      country: {
        type: "string",
        title: "Страна",
        minLength: 1,
        maxLength: 500,
      },
    },
    required: ["destination"],
    additionalProperties: false,
  },
};

export class FakeRequests
  implements RequestRepository, UnitOfWork<RequestTransaction>
{
  types: RequestTypeRecord[] = [enrollmentType];
  records: RequestRecord[] = [];
  events: RequestEventRecord[] = [];
  notifications: Parameters<RequestTransaction["notifications"]["add"]>[0][] =
    [];
  certificates: Parameters<RequestTransaction["certificates"]["create"]>[0][] =
    [];
  failNotification = false;
  demoUserIds = new Set<string>();
  seededDraftIds = new Set<string>();
  async isDemoAccount(userId: string) {
    return this.demoUserIds.has(userId);
  }
  pickup = new FakePickup(this);
  async listTypes() {
    return structuredClone(this.types);
  }
  async findType(code: string) {
    return structuredClone(
      this.types.find((type) => type.code === code) ?? null,
    );
  }
  async findProfileForStudent(id: string) {
    return new FakeStudentRepository().findProfileForStudent(id);
  }
  async listForStudent(id: string) {
    return structuredClone(this.records.filter((r) => r.studentId === id));
  }
  async findOldestUnseededDraftForStudent(studentId: string) {
    return structuredClone(
      this.records
        .filter(
          (record) =>
            record.studentId === studentId &&
            record.status === "draft" &&
            !this.seededDraftIds.has(record.id),
        )
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id),
        )[0] ?? null,
    );
  }
  async lockUsageForStudent(studentId: string, since: string) {
    const own = this.records.filter((record) => record.studentId === studentId);
    return {
      openDrafts: own.filter((record) => record.status === "draft").length,
      submissions: own.filter(
        (record) =>
          record.submittedAt !== null &&
          record.submittedAt > since &&
          record.submittedAt <=
            new Date(new Date(since).getTime() + 86_400_000).toISOString(),
      ).length,
    };
  }
  async findByIdForStudent(id: string, studentId: string) {
    return structuredClone(
      this.records.find((r) => r.id === id && r.studentId === studentId) ??
        null,
    );
  }
  async findByIdForFaculties(id: string, facultyIds: readonly string[]) {
    return structuredClone(
      this.records.find(
        (r) =>
          r.id === id &&
          facultyIds.includes(r.facultyId) &&
          r.status !== "draft",
      ) ?? null,
    );
  }
  async listEventsForStudent(id: string, studentId: string) {
    return structuredClone(
      (await this.findByIdForStudent(id, studentId))
        ? this.events.filter((e) => e.requestId === id)
        : [],
    );
  }
  async createDraft(record: RequestRecord) {
    this.records.push(structuredClone(record));
  }
  async save(record: RequestRecord, expected: RequestRecord, staff?: string) {
    const index = this.records.findIndex(
      (r) =>
        r.id === record.id &&
        r.status === expected.status &&
        r.updatedAt === expected.updatedAt,
    );
    if (index < 0) throw new ConflictError();
    this.records[index] = structuredClone({
      ...record,
      assignee: staff ?? record.assignee,
    });
  }
  async deleteDraftForStudent(id: string, studentId: string) {
    this.records = this.records.filter(
      (r) =>
        !(r.id === id && r.studentId === studentId && r.status === "draft"),
    );
  }
  async nextPublicNo(year: number) {
    const numbers = this.records.map((r) =>
      r.publicNo.startsWith(`З-${year}-`) ? Number(r.publicNo.slice(7)) : 0,
    );
    return `З-${year}-${String(Math.max(0, ...numbers) + 1).padStart(6, "0")}`;
  }
  async appendEvent(event: RequestEventRecord) {
    this.events.push(structuredClone(event));
  }
  async run<T>(work: (tx: RequestTransaction) => Promise<T>) {
    const snapshot = structuredClone({
      records: this.records,
      events: this.events,
      notifications: this.notifications,
      certificates: this.certificates,
      bookings: this.pickup.bookings,
    });
    try {
      return await work({
        requests: this,
        pickup: this.pickup,
        notifications: {
          add: async (input) => {
            if (this.failNotification) throw new Error("Тестовый отказ");
            this.notifications.push(structuredClone(input));
          },
        },
        certificates: {
          create: async (input) => {
            this.certificates.push(structuredClone(input));
          },
        },
      });
    } catch (error) {
      const { bookings, ...saved } = snapshot;
      Object.assign(this, saved);
      this.pickup.bookings = bookings;
      throw error;
    }
  }
}
