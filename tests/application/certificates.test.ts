import { expect, it, vi } from "vitest";
import { DownloadCertificate } from "@/application/certificates/download-certificate";
import { GetCertificateCard } from "@/application/certificates/get-certificate-card";
import type { CertificatePdfData } from "@/application/certificates/ports";
import { VerifyCertificate } from "@/application/certificates/verify-certificate";
import {
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
} from "@/application/shared/errors";
import {
  certificateCode,
  certificateRecord,
  certificateRequestId,
  FakeCertificateRepository,
} from "../fakes/certificates";
import { FakeClock } from "../fakes/clock";
import {
  anna,
  FakeRateLimiter,
  FakeStudentRepository,
  marina,
  timur,
} from "../fakes/identity";

function setup() {
  const repo = new FakeCertificateRepository();
  const students = new FakeStudentRepository();
  const pdf = {
    render: vi.fn(
      async (_data: CertificatePdfData, _qrPng: Uint8Array) =>
        new Uint8Array([37, 80, 68, 70]),
    ),
  };
  const qr = { encode: vi.fn(async (_url: string) => new Uint8Array([1])) };
  const clock = new FakeClock("2026-11-04T10:00:00.000Z");
  const limiter = new FakeRateLimiter(clock);
  return {
    repo,
    students,
    pdf,
    qr,
    clock,
    limiter,
    card: new GetCertificateCard(repo, qr, () => "https://pulse.example/path"),
    download: new DownloadCertificate(
      repo,
      students,
      pdf,
      qr,
      () => "https://pulse.example/path",
    ),
    verify: new VerifyCertificate(repo, students, limiter),
  };
}

it("карточка владельца: номер, тип, UTC-дата, отзыв и PNG той же ссылки, что в PDF", async () => {
  const f = setup();
  const png = new Uint8Array([137, 80, 78, 71, 0, 255, 128]);
  f.qr.encode.mockResolvedValue(png);
  const card = await f.card.execute(anna, { id: certificateRequestId });
  expect(card).toEqual({
    number: certificateRecord.number,
    type: certificateRecord.type,
    issuedAt: certificateRecord.issuedAt,
    revoked: false,
    verificationUrl: `https://pulse.example/verify/${certificateCode}`,
    qrDataUrl: `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
  });
  await f.download.execute(anna, { id: certificateRequestId });
  expect(f.qr.encode.mock.calls.map(([url]) => url)).toEqual([
    card.verificationUrl,
    card.verificationUrl,
  ]);
  expect(f.pdf.render.mock.calls[0]?.[0].verificationUrl).toBe(
    card.verificationUrl,
  );
  if (f.repo.record) f.repo.record.revokedAt = "2026-11-05T10:00:00.000Z";
  expect(
    await f.card.execute(anna, { id: certificateRequestId }),
  ).toMatchObject({ revoked: true, qrDataUrl: card.qrDataUrl });
});

it("карточка: чужая, неизвестная и неготовая заявка дают 404 без генерации QR", async () => {
  const f = setup();
  await expect(
    f.card.execute(timur, { id: certificateRequestId }),
  ).rejects.toThrow(NotFoundError);
  for (const id of ["bad", "019a4b5c-0000-7000-8000-000000000002"])
    await expect(f.card.execute(anna, { id })).rejects.toThrow(NotFoundError);
  f.repo.ready = false;
  await expect(
    f.card.execute(anna, { id: certificateRequestId }),
  ).rejects.toThrow(NotFoundError);
  f.repo.record = null;
  await expect(
    f.card.execute(anna, { id: certificateRequestId }),
  ).rejects.toThrow(NotFoundError);
  expect(f.qr.encode).not.toHaveBeenCalled();
});

it("карточка: сотрудник запрещён до чтения БД; неверный номер не раскрывается", async () => {
  const f = setup();
  await expect(
    f.card.execute(marina, { id: certificateRequestId }),
  ).rejects.toThrow(ForbiddenError);
  expect(f.repo.reads).toBe(0);
  if (f.repo.record) f.repo.record.number = "invalid";
  await expect(
    f.card.execute(anna, { id: certificateRequestId }),
  ).rejects.toThrow(NotFoundError);
  expect(f.qr.encode).not.toHaveBeenCalled();
});

it("владелец скачивает PDF и QR с абсолютным URL, без зачётки", async () => {
  const f = setup();
  const result = await f.download.execute(anna, { id: certificateRequestId });
  expect(result.number).toBe(certificateRecord.number);
  expect(f.qr.encode).toHaveBeenCalledWith(
    `https://pulse.example/verify/${certificateCode}`,
  );
  const data = f.pdf.render.mock.calls[0]?.[0];
  expect(data).toMatchObject({
    number: certificateRecord.number,
    destination: certificateRecord.destination,
    course: 2,
  });
  expect(data).not.toHaveProperty("recordBookNo");
});

it("чужая, отсутствующая и неготовая запись не раскрываются; сотруднику 403", async () => {
  const f = setup();
  await expect(
    f.download.execute(timur, { id: certificateRequestId }),
  ).rejects.toThrow(NotFoundError);
  await expect(
    f.download.execute(marina, { id: certificateRequestId }),
  ).rejects.toThrow(ForbiddenError);
  for (const id of ["bad", "019a4b5c-0000-7000-8000-000000000002"])
    await expect(f.download.execute(anna, { id })).rejects.toThrow(
      NotFoundError,
    );
  f.repo.record = null;
  await expect(
    f.download.execute(anna, { id: certificateRequestId }),
  ).rejects.toThrow(NotFoundError);
  expect(f.pdf.render).not.toHaveBeenCalled();
});

it("публичная проверка отдаёт только разрешённые поля и отзыв", async () => {
  const f = setup();
  const profile = f.students.profiles.get("anna-student");
  if (!profile) throw new Error("Нужен профиль.");
  f.students.profiles.set("anna-student", {
    ...profile,
    fullName: "Анна Игоревна Соколова",
  });
  expect(
    await f.verify.execute({ code: certificateCode, ipHash: "hash" }),
  ).toEqual({
    number: certificateRecord.number,
    type: certificateRecord.type,
    issuedAt: certificateRecord.issuedAt,
    fullName: "Соколова А. И.",
    status: "valid",
  });
  if (f.repo.record) f.repo.record.revokedAt = "2026-11-05T10:00:00.000Z";
  expect(
    await f.verify.execute({ code: certificateCode, ipHash: "hash" }),
  ).toMatchObject({ status: "revoked" });
});

it("невалидные коды не доходят до репозитория, все попытки ограничены до БД", async () => {
  const f = setup();
  for (let i = 0; i < 30; i++)
    await expect(
      f.verify.execute({ code: "invalid", ipHash: "hash" }),
    ).rejects.toThrow(NotFoundError);
  expect(f.repo.reads).toBe(0);
  await expect(
    f.verify.execute({ code: certificateCode, ipHash: "hash" }),
  ).rejects.toThrow(RateLimitedError);
  expect(f.repo.reads).toBe(0);
  expect(
    await f.verify.execute({ code: certificateCode, ipHash: "other" }),
  ).toMatchObject({ status: "valid" });
  f.clock.advance(600_001);
  expect(
    await f.verify.execute({ code: certificateCode, ipHash: "hash" }),
  ).toMatchObject({ status: "valid" });
});

it("одновременно проходят ровно 30 попыток; неизвестный код даёт 404", async () => {
  const f = setup();
  const results = await Promise.allSettled(
    Array.from({ length: 40 }, () =>
      f.verify.execute({ code: certificateCode, ipHash: "same" }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(30);
  expect(
    results.filter(
      (r) => r.status === "rejected" && r.reason instanceof RateLimitedError,
    ),
  ).toHaveLength(10);
  await expect(
    f.verify.execute({ code: "A".repeat(26), ipHash: "new" }),
  ).rejects.toThrow(NotFoundError);
});
