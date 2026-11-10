import type {
  CertificateRecord,
  CertificateRepository,
} from "@/application/certificates/ports";

export const certificateRequestId = "019a4b5c-0000-7000-8000-000000000001";
export const certificateCode = `${"ABCDEFGHIJKLMNOPQRSTUVWXYZ".slice(0, 25)}A`;
export const certificateRecord: CertificateRecord = {
  studentId: "anna-student",
  number: "С-2026-000045",
  verifyCode: certificateCode,
  type: "Справка об обучении",
  destination: "Учебная организация «Пример»",
  issuedAt: "2026-11-04T22:30:00.000Z",
  revokedAt: null,
};

export class FakeCertificateRepository implements CertificateRepository {
  record: CertificateRecord | null = structuredClone(certificateRecord);
  ready = true;
  reads = 0;
  async findByRequestIdForStudent(id: string, studentId: string) {
    this.reads++;
    return this.ready &&
      id === certificateRequestId &&
      studentId === this.record?.studentId
      ? structuredClone(this.record)
      : null;
  }
  async findByVerificationCode(code: string) {
    this.reads++;
    return code === this.record?.verifyCode
      ? structuredClone(this.record)
      : null;
  }
}
