import { expect, it, vi } from "vitest";
import { DownloadCertificate } from "@/application/certificates/download-certificate";
import { GetCertificateCard } from "@/application/certificates/get-certificate-card";
import {
  GetCalendar,
  RenewCalendarToken,
} from "@/application/schedule/calendar";
import { absoluteAppUrl } from "@/application/shared/app-path.mjs";
import { NotFoundError } from "@/application/shared/errors";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import {
  PostgresCalendarTokenStore,
  PostgresScheduleRepository,
} from "@/infrastructure/db/repositories/schedule/repository";
import { LocalPdfRenderer } from "@/infrastructure/pdf/pdf-renderer";
import { LocalQrEncoder } from "@/infrastructure/pdf/qr-encoder";
import {
  certificatePdfHasQrUrl,
  certificatePdfHasVerificationLink,
} from "../unit/certificates-pdf-qr";
import { attendanceServices, openAttendanceTestData } from "./attendance-data";
import { openCertificatesFixture } from "./certificates-fixture";

it.each(["", "/dekanat"])(
  "PostgreSQL: ссылки справки, QR PDF, календарь и владелец %s",
  async (base) => {
    vi.stubEnv("BASE_PATH", "/neighbor");
    const f = await openCertificatesFixture();
    const origin = "https://pulse.example";
    const qr = new LocalQrEncoder();
    const card = new GetCertificateCard(
      f.repo,
      qr,
      () => origin,
      () => base,
    );
    const download = new DownloadCertificate(
      f.repo,
      f.students,
      new LocalPdfRenderer(),
      qr,
      () => origin,
      () => base,
    );
    try {
      const ready = await f.request();
      const result = await card.execute(f.anna.actor, { id: ready.id });
      const expected = `${origin}${base}/verify/${ready.certificate?.verifyCode}`;
      expect(result.verificationUrl).toBe(expected);
      expect(result.qrDataUrl).toBe(
        `data:image/png;base64,${Buffer.from(await qr.encode(expected)).toString("base64")}`,
      );
      const pdf = (await download.execute(f.anna.actor, { id: ready.id }))
        .bytes;
      expect(await certificatePdfHasQrUrl(pdf, expected)).toBe(true);
      expect(await certificatePdfHasVerificationLink(pdf, expected)).toBe(true);
      await expect(
        card.execute(f.timur.actor, { id: ready.id }),
      ).rejects.toThrow(NotFoundError);
      await expect(
        download.execute(f.timur.actor, { id: ready.id }),
      ).rejects.toThrow(NotFoundError);
      const store = new PostgresCalendarTokenStore(() => f.staff.sql);
      const tokens = new CryptoSessionTokens();
      const repo = new PostgresScheduleRepository(() => f.staff.sql);
      const renewal = await new RenewCalendarToken(
        store,
        tokens,
        f.staff.ids,
        repo,
      ).execute(f.anna.actor);
      const url = new URL(absoluteAppUrl(origin, renewal.path, base));
      expect(url.origin).toBe(origin);
      expect(url.pathname.startsWith(`${base}/api/calendar/`)).toBe(true);
      expect(
        await new GetCalendar(store, tokens, repo, f.staff.clock).execute(
          url.pathname.split("/").at(-1),
        ),
      ).toContain("BEGIN:VCALENDAR");
    } finally {
      await f.close();
    }
  },
  30_000,
);

it.each(["", "/dekanat"])(
  "PostgreSQL: URL и QR отметки преподавателя %s",
  async (base) => {
    vi.stubEnv("BASE_PATH", "/neighbor");
    const f = await openAttendanceTestData();
    try {
      const service = attendanceServices(f, { now: () => new Date() }, base);
      const result = await service.issue.execute(f.teacher.actor, {
        lesson: f.key,
        ip: "192.0.2.59",
      });
      expect(result.url).toBe(`https://pulse.example${base}${result.path}`);
      expect(result.qrImage).toContain("data:image/");
      expect(
        await service.preview.execute(f.student.actor, {
          code: result.path.split("/").at(-1),
        }),
      ).toBeDefined();
    } finally {
      await f.close();
    }
  },
  30_000,
);
