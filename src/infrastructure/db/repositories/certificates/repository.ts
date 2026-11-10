import type { Sql } from "postgres";
import type {
  CertificateRecord,
  CertificateRepository,
} from "@/application/certificates/ports";
import { certificateDestination } from "@/domain/certificates/certificate";

interface Row
  extends Omit<CertificateRecord, "issuedAt" | "revokedAt" | "destination"> {
  issuedAt: Date;
  revokedAt: Date | null;
  typeCode: string;
  payload: Record<string, unknown>;
}

export class PostgresCertificateRepository implements CertificateRepository {
  constructor(private readonly database: () => Sql) {}

  async findByRequestIdForStudent(requestId: string, studentId: string) {
    const sql = this.database();
    return this.find(sql`r.id = ${requestId} and r.student_id = ${studentId}`);
  }

  async findByVerificationCode(code: string) {
    return this.find(this.database()`c.verify_code = ${code}`);
  }

  private async find(where: ReturnType<Sql>) {
    const [row] = await this.database()<Row[]>`
      select c.number, c.verify_code as "verifyCode", c.issued_at as "issuedAt",
        c.revoked_at as "revokedAt", r.student_id as "studentId", t.title as type,
        r.type_code as "typeCode", r.payload
      from certificates c join requests r on r.id = c.request_id
      join request_types t on t.code = r.type_code
      where ${where} and r.status in ('ready', 'issued') and t.is_certificate = true
      limit 1`;
    if (!row) return null;
    const { typeCode, payload, ...record } = row;
    return {
      ...record,
      issuedAt: record.issuedAt.toISOString(),
      revokedAt: record.revokedAt?.toISOString() ?? null,
      destination: certificateDestination(typeCode, payload),
    };
  }
}
