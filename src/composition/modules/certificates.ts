import "server-only";
import { DownloadCertificate } from "@/application/certificates/download-certificate";
import { GetCertificateCard } from "@/application/certificates/get-certificate-card";
import { VerifyCertificate } from "@/application/certificates/verify-certificate";
import { getClientIp } from "@/infrastructure/auth/request-ip";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { getBasePath } from "@/infrastructure/config/base-path";
import { getEnv } from "@/infrastructure/config/env";
import { getDatabase } from "@/infrastructure/db/client";
import { PostgresCertificateRepository } from "@/infrastructure/db/repositories/certificates/repository";
import { PostgresRateLimiter } from "@/infrastructure/db/repositories/identity/rate-limiter";
import { PostgresStudentRepository } from "@/infrastructure/db/repositories/student/profile";
import {
  certificateFonts,
  verificationTokens,
} from "@/infrastructure/pdf/assets";
import { LocalPdfRenderer } from "@/infrastructure/pdf/pdf-renderer";
import { LocalQrEncoder } from "@/infrastructure/pdf/qr-encoder";
import type { createSystemModule } from "./system";

export function createCertificatesModule(
  system: ReturnType<typeof createSystemModule>,
) {
  const repo = new PostgresCertificateRepository(getDatabase);
  const students = new PostgresStudentRepository(getDatabase);
  const hashes = new CryptoSessionTokens();
  return {
    card: new GetCertificateCard(
      repo,
      new LocalQrEncoder(),
      () => getEnv("APP_ORIGIN"),
      getBasePath,
    ),
    download: new DownloadCertificate(
      repo,
      students,
      new LocalPdfRenderer(),
      new LocalQrEncoder(),
      () => getEnv("APP_ORIGIN"),
      getBasePath,
    ),
    verify: new VerifyCertificate(
      repo,
      students,
      new PostgresRateLimiter(getDatabase, system.clock, system.ids),
    ),
    ipHash: (forwardedFor: string | null) =>
      hashes.hash(getClientIp(forwardedFor)),
    fonts: certificateFonts,
    tokens: verificationTokens,
  };
}
