import { PDFDocument } from "pdf-lib";
import QRCode from "qrcode";
import { expect, it, vi } from "vitest";
import type { CertificatePdfData } from "@/application/certificates/ports";
import { certificateDestination } from "@/domain/certificates/certificate";
import { LocalPdfRenderer } from "@/infrastructure/pdf/pdf-renderer";
import { LocalQrEncoder } from "@/infrastructure/pdf/qr-encoder";
import { certificateRecord } from "../fakes/certificates";
import { certificatePdfHasQrUrl } from "./certificates-pdf-qr";
import { certificatePdfText } from "./certificates-pdf-text";

const certificatePdfData: CertificatePdfData = {
  ...certificateRecord,
  fullName: "Соколова Анна Игоревна",
  faculty: "Факультет международных отношений",
  program: "Международные отношения",
  course: 2,
  group: "МО-2-01",
  revoked: false,
  verificationUrl: `https://pulse.example/verify/${certificateRecord.verifyCode}`,
};

it("QR получает точный абсолютный URL и возвращает PNG с полями для сканирования", async () => {
  const spy = vi.spyOn(QRCode, "toBuffer");
  const png = await new LocalQrEncoder().encode(
    certificatePdfData.verificationUrl,
  );
  expect(spy).toHaveBeenCalledWith(
    certificatePdfData.verificationUrl,
    expect.objectContaining({
      type: "png",
      errorCorrectionLevel: "M",
      margin: 4,
      width: 320,
    }),
  );
  expect(Buffer.from(png).subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
});

it("PDF встраивает кириллицу и содержит номер в настоящем текстовом слое", async () => {
  const qr = await new LocalQrEncoder().encode(
    certificatePdfData.verificationUrl,
  );
  const bytes = await new LocalPdfRenderer().render(certificatePdfData, qr);
  expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF");
  const text = await certificatePdfText(bytes);
  for (const expected of [
    certificateRecord.number,
    certificatePdfData.fullName,
    certificatePdfData.faculty,
    certificatePdfData.program,
    certificatePdfData.group,
    certificateRecord.destination,
    "Дата выдачи: 5 ноября 2026 г. (МСК)",
    "Вымышленная справка конкурсного концепта",
    "Не является официальным документом",
  ])
    expect(text).toContain(expected);
  expect(text).not.toContain("�");
  expect(text).not.toContain("DEMO-");
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  expect(
    await certificatePdfHasQrUrl(bytes, certificatePdfData.verificationUrl),
  ).toBe(true);
  expect(
    await certificatePdfHasQrUrl(bytes, "https://other.example/verify/unknown"),
  ).toBe(false);
});

it("PDF справки military сохраняет строку указанного военкомата", async () => {
  const office = "Военный комиссариат ДЕМО-района";
  const bytes = await new LocalPdfRenderer().render(
    {
      ...certificatePdfData,
      type: "Справка для военкомата",
      destination: certificateDestination("military", { office }),
    },
    await new LocalQrEncoder().encode(certificatePdfData.verificationUrl),
  );
  const text = await certificatePdfText(bytes);
  expect(text).toContain("Справка для военкомата");
  expect(text).toContain(`Место требования: ${office}`);
  expect(text).not.toContain("По месту требования");
});

it("длинные поля переносятся без потери текста; отзыв заметен в PDF", async () => {
  const longDestination = "Ж".repeat(500);
  const bytes = await new LocalPdfRenderer().render(
    { ...certificatePdfData, destination: longDestination, revoked: true },
    await new LocalQrEncoder().encode(certificatePdfData.verificationUrl),
  );
  const text = await certificatePdfText(bytes);
  expect(text.replaceAll("\n", "")).toContain(longDestination);
  expect(text).toContain("ОТОЗВАНА");
});
