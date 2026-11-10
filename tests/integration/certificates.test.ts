import { expect, it } from "vitest";
import { GetCertificateCard } from "@/application/certificates/get-certificate-card";
import { VerifyCertificate } from "@/application/certificates/verify-certificate";
import { NotFoundError, RateLimitedError } from "@/application/shared/errors";
import { PostgresRateLimiter } from "@/infrastructure/db/repositories/identity/rate-limiter";
import { LocalQrEncoder } from "@/infrastructure/pdf/qr-encoder";
import { openCertificatesFixture } from "./certificates-fixture";

it("карточка справки не раскрывает данные другого студента и неготового результата", async () => {
  const f = await openCertificatesFixture();
  const card = new GetCertificateCard(
    f.repo,
    new LocalQrEncoder(),
    () => "https://pulse.example",
  );
  try {
    const ready = await f.request();
    const result = await card.execute(f.anna.actor, { id: ready.id });
    expect(result.number).toBe(ready.certificate?.number);
    expect(result.verificationUrl).toBe(
      `https://pulse.example/verify/${ready.certificate?.verifyCode}`,
    );
    expect(result.qrDataUrl).toBe(
      `data:image/png;base64,${Buffer.from(await new LocalQrEncoder().encode(result.verificationUrl)).toString("base64")}`,
    );
    await expect(card.execute(f.timur.actor, { id: ready.id })).rejects.toThrow(
      NotFoundError,
    );
    const pending = await f.request("submitted");
    await expect(
      card.execute(f.anna.actor, { id: pending.id }),
    ).rejects.toThrow(NotFoundError);
    await f.revoke(ready.id);
    expect(await card.execute(f.anna.actor, { id: ready.id })).toMatchObject({
      revoked: true,
      verificationUrl: result.verificationUrl,
      qrDataUrl: result.qrDataUrl,
    });
  } finally {
    await f.close();
  }
}, 20_000);

it("адресат PDF берётся из поля типа справки и не раскрывается публично", async () => {
  const f = await openCertificatesFixture();
  const ipHash = `test-${f.staff.ids.next()}`;
  const verify = new VerifyCertificate(
    f.repo,
    f.students,
    new PostgresRateLimiter(() => f.staff.sql, f.staff.clock, f.staff.ids),
  );
  try {
    for (const [typeCode, field, destination] of [
      ["military", "office", "Военный комиссариат ДЕМО-района"],
      ["enrollment", "destination", "Учебная организация «Пример»"],
      ["visa", "destination", "Визовый центр «ДЕМО»"],
      ["scholarship", "destination", "Учебный центр «ДЕМО»"],
    ] as const) {
      const ready = await f.request("ready", {
        typeCode,
        payload: { [field]: destination },
      });
      expect(ready.certificate?.destination).toBe(destination);
      if (!ready.certificate) throw new Error("Ожидалась справка.");
      const publicData = await verify.execute({
        code: ready.certificate.verifyCode,
        ipHash,
      });
      expect(publicData).toEqual({
        number: ready.certificate.number,
        type: ready.certificate.type,
        issuedAt: ready.certificate.issuedAt,
        fullName: "Соколова А.",
        status: "valid",
      });
      expect(JSON.stringify(publicData)).not.toContain(destination);
    }
  } finally {
    await f.staff
      .sql`delete from login_attempts where key = ${`certificate-ip:${ipHash}`}`;
    await f.close();
  }
}, 20_000);

it("пустой адресат в сохранённой справке заменяется на «По месту требования»", async () => {
  const f = await openCertificatesFixture();
  try {
    for (const [typeCode, field, otherField] of [
      ["military", "office", "destination"],
      ["enrollment", "destination", "office"],
    ] as const) {
      const ready = await f.request("ready", {
        typeCode,
        payload: { [field]: "Адресат ДЕМО" },
      });
      for (const empty of ["", " \t ", null, undefined]) {
        // Required fields cannot be submitted empty; cover legacy stored data.
        const payload = {
          [field]: empty,
          [otherField]: "Чужое поле не должно стать адресатом",
        };
        await f.staff
          .sql`update requests set payload = ${JSON.stringify(payload)}::jsonb where id = ${ready.id}`;
        const record = await f.repo.findByRequestIdForStudent(
          ready.id,
          f.anna.actor.studentId,
        );
        expect(record?.destination).toBe("По месту требования");
      }
    }
  } finally {
    await f.close();
  }
}, 20_000);

it("репозиторий изолирует владельца, статусы и коды; даты ISO и отзыв", async () => {
  const f = await openCertificatesFixture();
  try {
    const ready = await f.request();
    const certificate = ready.certificate;
    expect(certificate).not.toBeNull();
    if (!certificate) throw new Error("Ожидалась справка.");
    expect(certificate.number).toMatch(/^С-\d{4}-\d{6,}$/);
    expect(certificate.issuedAt).toMatch(/Z$/);
    expect(
      await f.repo.findByRequestIdForStudent(ready.id, f.timur.actor.studentId),
    ).toBeNull();
    expect(
      await f.repo.findByRequestIdForStudent(
        f.staff.ids.next(),
        f.anna.actor.studentId,
      ),
    ).toBeNull();
    expect(await f.repo.findByVerificationCode("A".repeat(26))).toBeNull();
    expect(await f.repo.findByVerificationCode(certificate.verifyCode)).toEqual(
      certificate,
    );
    expect((await f.request("submitted")).certificate).toBeNull();
    expect((await f.request("issued")).certificate).not.toBeNull();
    await f.revoke(ready.id);
    expect(
      (await f.repo.findByVerificationCode(certificate.verifyCode))?.revokedAt,
    ).toMatch(/Z$/);
    const [type] = await f.staff.sql<
      { isCertificate: boolean }[]
    >`select is_certificate as "isCertificate" from request_types where code = 'enrollment'`;
    expect(type?.isCertificate).toBe(true);
    await f.staff
      .sql`update requests set status = 'in_progress' where id = ${ready.id}`;
    expect(
      await f.repo.findByVerificationCode(certificate.verifyCode),
    ).toBeNull();
  } finally {
    await f.close();
  }
}, 20_000);

it("PostgreSQL атомарно ограничивает публичный перебор до чтения справки", async () => {
  const f = await openCertificatesFixture();
  const ipHash = `test-${f.staff.ids.next()}`;
  try {
    const verify = new VerifyCertificate(
      f.repo,
      f.students,
      new PostgresRateLimiter(() => f.staff.sql, f.staff.clock, f.staff.ids),
    );
    const results = await Promise.allSettled(
      Array.from({ length: 35 }, () =>
        verify.execute({ code: "A".repeat(26), ipHash }),
      ),
    );
    expect(
      results.filter(
        (r) => r.status === "rejected" && r.reason instanceof NotFoundError,
      ),
    ).toHaveLength(30);
    expect(
      results.filter(
        (r) => r.status === "rejected" && r.reason instanceof RateLimitedError,
      ),
    ).toHaveLength(5);
  } finally {
    await f.staff
      .sql`delete from login_attempts where key = ${`certificate-ip:${ipHash}`}`;
    await f.close();
  }
}, 20_000);
