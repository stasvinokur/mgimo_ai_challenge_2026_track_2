import { randomBytes } from "node:crypto";
import { test as base, expect } from "@playwright/test";
import { getClientIp } from "@/infrastructure/auth/request-ip";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { openCertificatesFixture } from "../integration/certificates-fixture";

type CertificatesFixture = Awaited<ReturnType<typeof openCertificatesFixture>>;

export const test = base.extend<{
  certificates: CertificatesFixture;
  certificateIp: string;
}>({
  certificateIp: async ({ baseURL }, use) => {
    if (!baseURL) throw new Error("Нужен адрес приложения.");
    const parts = randomBytes(6).toString("hex").match(/.{4}/g) ?? [];
    await use(`fd19:${parts.join(":")}::1`);
  },
  certificates: async ({ baseURL, certificateIp }, use) => {
    base.skip(!process.env.DATABASE_URL, "Нужна БД для временного студента.");
    if (!baseURL) throw new Error("Нужен адрес приложения.");
    const fixture = await openCertificatesFixture();
    try {
      await use(fixture);
    } finally {
      const hash = new CryptoSessionTokens().hash(getClientIp(certificateIp));
      await fixture.staff
        .sql`delete from login_attempts where key = ${`certificate-ip:${hash}`}`;
      await fixture.close();
    }
  },
});

export { expect };
