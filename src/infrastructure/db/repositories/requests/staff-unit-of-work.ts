import type { Sql } from "postgres";
import type { AuditLog } from "@/application/ports/audit-log";
import type { IdGenerator } from "@/application/ports/id-generator";
import type { UnitOfWork } from "@/application/ports/unit-of-work";
import type { StaffTransaction } from "@/application/staff/ports";
import { staffAuditLog } from "../../schema/audit";
import type { RequestsDatabase } from "./repository";
import { createRequestTransaction } from "./unit-of-work";

class DrizzleStaffAuditLog implements AuditLog {
  constructor(
    private readonly database: () => RequestsDatabase,
    private readonly ids: IdGenerator,
  ) {}
  async record(entry: Parameters<AuditLog["record"]>[0]) {
    await this.database()
      .insert(staffAuditLog)
      .values({
        id: this.ids.next(),
        staffUserId: entry.userId,
        action: entry.action,
        requestId: entry.entityId,
        at: new Date(entry.occurredAt),
      });
  }
}
export class DrizzleStaffUnitOfWork implements UnitOfWork<StaffTransaction> {
  constructor(
    private readonly database: () => Sql,
    private readonly ids: IdGenerator,
  ) {}
  async run<T>(work: (context: StaffTransaction) => Promise<T>): Promise<T> {
    const client = this.database();
    return client.begin(async (sql) => {
      const { database, ...tx } = createRequestTransaction(
        sql,
        this.ids,
        client.options,
      );
      return work({
        ...tx,
        audit: new DrizzleStaffAuditLog(() => database, this.ids),
      });
    }) as Promise<T>;
  }
}
