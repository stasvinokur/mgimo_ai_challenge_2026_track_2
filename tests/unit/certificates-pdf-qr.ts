import {
  decodePDFRawStream,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFString,
} from "pdf-lib";
import { LocalQrEncoder } from "@/infrastructure/pdf/qr-encoder";

function images(document: PDFDocument) {
  return document.context
    .enumerateIndirectObjects()
    .flatMap(([, object]) =>
      object instanceof PDFRawStream &&
      object.dict.get(PDFName.of("Subtype"))?.toString() === "/Image"
        ? [Buffer.from(decodePDFRawStream(object).decode())]
        : [],
    );
}

export async function certificatePdfHasVerificationLink(
  bytes: Uint8Array,
  url: string,
) {
  return (await PDFDocument.load(bytes)).context
    .enumerateIndirectObjects()
    .some(
      ([, object]) =>
        object instanceof PDFDict &&
        object.get(PDFName.of("Subtype"))?.toString() === "/Link" &&
        object
          .lookupMaybe(PDFName.of("A"), PDFDict)
          ?.lookupMaybe(PDFName.of("URI"), PDFString)
          ?.decodeText() === url,
    );
}

// Compare embedded pixels to an encoding of the expected URL; no QR decoder/Poppler.
export async function certificatePdfHasQrUrl(bytes: Uint8Array, url: string) {
  const expected = await PDFDocument.create();
  const qr = await expected.embedPng(await new LocalQrEncoder().encode(url));
  expected.addPage().drawImage(qr);
  await expected.save();
  const expectedImage = images(expected)[0];
  return (
    expectedImage !== undefined &&
    images(await PDFDocument.load(bytes)).some((image) =>
      image.equals(expectedImage),
    )
  );
}
