import type { RateLimiter } from "@/application/ports/rate-limiter";
import { NotFoundError, RateLimitedError } from "@/application/shared/errors";
import type { StudentRepository } from "@/application/student/ports";
import {
  isVerificationCode,
  maskFullName,
} from "@/domain/certificates/certificate";
import type { CertificateRepository } from "./ports";

export const VERIFICATION_LIMIT = 30;
export const VERIFICATION_WINDOW_SEC = 600;

export class VerifyCertificate {
  constructor(
    private readonly certificates: CertificateRepository,
    private readonly students: StudentRepository,
    private readonly limiter: RateLimiter,
  ) {}

  async execute(input: { code: string; ipHash: string }) {
    const reservation = await this.limiter.reserve([
      {
        key: `certificate-ip:${input.ipHash}`,
        limit: VERIFICATION_LIMIT,
        windowSec: VERIFICATION_WINDOW_SEC,
      },
    ]);
    if (!reservation) throw new RateLimitedError();
    // Every public lookup consumes a slot, including malformed/unknown codes.
    await reservation.commitFailure();
    if (!isVerificationCode(input.code)) throw new NotFoundError();
    const record = await this.certificates.findByVerificationCode(input.code);
    if (!record) throw new NotFoundError();
    const profile = await this.students.findProfileForStudent(record.studentId);
    if (!profile) throw new NotFoundError();
    return {
      number: record.number,
      type: record.type,
      issuedAt: record.issuedAt,
      fullName: maskFullName(profile.fullName),
      status:
        record.revokedAt === null ? ("valid" as const) : ("revoked" as const),
    };
  }
}

export type CertificateVerificationDto = Awaited<
  ReturnType<VerifyCertificate["execute"]>
>;
