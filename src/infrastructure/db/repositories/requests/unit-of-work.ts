import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import type { Sql, TransactionSql } from "postgres";
import type { IdGenerator } from "@/application/ports/id-generator";
import type { UnitOfWork } from "@/application/ports/unit-of-work";
import type {
  RequestCertificates,
  RequestTransaction,
} from "@/application/requests/ports";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import * as schema from "../../schema";
import { certificates } from "../../schema/certificates";
import { PostgresAttendanceRecords } from "../attendance/repository";
import { PostgresScheduleRepository } from "../schedule/repository";
import { DrizzleRequestNotifications } from "./notifications";
import { PostgresPickupRepository } from "./pickup-repository";
import { DrizzleRequestRepository, type RequestsDatabase } from "./repository";

export class DrizzleRequestCertificates implements RequestCertificates {
  constructor(private readonly database: () => RequestsDatabase) {}
  async create(input: Parameters<RequestCertificates["create"]>[0]) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = 0;
    let value = 0;
    let code = "";
    for (const byte of randomBytes(16)) {
      value = (value << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        bits -= 5;
        code += alphabet[(value >>> bits) & 31];
      }
    }
    if (bits) code += alphabet[(value << (5 - bits)) & 31];
    await this.database()
      .insert(certificates)
      .values({
        id: input.id,
        requestId: input.requestId,
        number: input.publicNo.replace(/^З-/, "С-"),
        verifyCode: code,
        issuedAt: new Date(input.at),
      });
  }
}

export function createRequestTransaction(
  sql: TransactionSql,
  ids: IdGenerator,
  options: Sql["options"],
): RequestTransaction & { database: RequestsDatabase } {
  // postgres.js omits public options on scoped Sql; Drizzle needs the parent codecs.
  const scoped = Object.assign(sql, { options }) as unknown as Sql;
  const database = drizzle(scoped, { schema });
  const attendance = new PostgresAttendanceRecords(() => scoped, ids);
  return {
    database,
    requests: new DrizzleRequestRepository(() => database),
    notifications: new DrizzleRequestNotifications(() => database),
    certificates: new DrizzleRequestCertificates(() => database),
    pickup: new PostgresPickupRepository(() => scoped),
    eventRelease: {
      schedule: new PostgresScheduleRepository(() => scoped),
      attendance: {
        markExcusedForStudent:
          attendance.markExcusedForStudent.bind(attendance),
        awardActivityForStudent:
          attendance.awardActivityForStudent.bind(attendance),
      },
    },
  };
}

export class DrizzleRequestsUnitOfWork
  implements UnitOfWork<RequestTransaction>
{
  constructor(
    private readonly database: () => Sql,
    private readonly ids: IdGenerator = new UuidV7Generator(),
  ) {}
  async run<T>(work: (context: RequestTransaction) => Promise<T>): Promise<T> {
    const client = this.database();
    return client.begin(async (sql) => {
      const { database: _database, ...tx } = createRequestTransaction(
        sql,
        this.ids,
        client.options,
      );
      return work(tx);
    }) as Promise<T>;
  }
}
