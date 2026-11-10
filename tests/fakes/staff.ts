import type { AuditEntry } from "@/application/ports/audit-log";
import type { UnitOfWork } from "@/application/ports/unit-of-work";
import type {
  StaffEventContext,
  StaffRequestRepository,
  StaffTransaction,
} from "@/application/staff/ports";
import { FakeRequests } from "./requests";

export class FakeStaff
  implements StaffRequestRepository, UnitOfWork<StaffTransaction>
{
  requests = new FakeRequests();
  demoUserIds = this.requests.demoUserIds;
  async isDemoUser(userId: string) {
    return this.demoUserIds.has(userId);
  }
  eventContexts = new Map<string, StaffEventContext>();
  async findEventContextForFaculties(id: string, faculties: readonly string[]) {
    if (!(await this.findByIdForFaculties(id, faculties))) return null;
    return structuredClone(this.eventContexts.get(id) ?? null);
  }
  audit: AuditEntry[] = [];
  failAudit = false;
  async listTypes() {
    return this.requests.listTypes();
  }
  private row(record: (typeof this.requests.records)[number]) {
    return {
      request: structuredClone(record),
      assigneeStaffId: record.assignee,
      student: {
        fullName: "Учебный студент",
        group: "ДЕМО-1",
        faculty: record.facultyId,
      },
    };
  }
  async listForFaculties(faculties: readonly string[], since: string) {
    return this.requests.records
      .filter(
        (r) =>
          faculties.includes(r.facultyId) &&
          !["draft", "cancelled"].includes(r.status) &&
          (!["issued", "rejected"].includes(r.status) || r.updatedAt >= since),
      )
      .map((r) => this.row(r));
  }
  async findByIdForFaculties(id: string, faculties: readonly string[]) {
    const record = await this.requests.findByIdForFaculties(id, faculties);
    return record ? this.row(record) : null;
  }
  async listEventsForFaculties(id: string, faculties: readonly string[]) {
    return (await this.findByIdForFaculties(id, faculties))
      ? structuredClone(this.requests.events.filter((e) => e.requestId === id))
      : [];
  }
  async listAuditForFaculties(id: string, faculties: readonly string[]) {
    return (await this.findByIdForFaculties(id, faculties))
      ? this.audit
          .filter((e) => e.entityId === id)
          .map((e, index) => ({
            id: String(index),
            action: e.action,
            at: e.occurredAt,
            staffName: "Учебный сотрудник",
          }))
      : [];
  }
  async run<T>(work: (tx: StaffTransaction) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(this.audit);
    try {
      return await this.requests.run((tx) =>
        work({
          ...tx,
          audit: {
            record: async (entry) => {
              this.audit.push(structuredClone(entry));
              if (this.failAudit) throw new Error("Тестовый сбой аудита");
            },
          },
        }),
      );
    } catch (error) {
      this.audit = snapshot;
      throw error;
    }
  }
}
