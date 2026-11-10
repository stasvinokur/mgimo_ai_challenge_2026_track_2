import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, PDFString, rgb } from "pdf-lib";
import { formatCertificateDate } from "@/application/certificates/format-date";
import type {
  CertificatePdfData,
  PdfRenderer,
} from "@/application/certificates/ports";
import { certificateFonts } from "./assets";

export class LocalPdfRenderer implements PdfRenderer {
  async render(data: CertificatePdfData, qrPng: Uint8Array) {
    const document = await PDFDocument.create();
    document.registerFontkit(fontkit);
    const fonts = await Promise.all(
      (await certificateFonts()).map((bytes) =>
        document.embedFont(bytes, { subset: true }),
      ),
    );
    const fallback = fonts[0];
    if (!fallback) throw new Error("Не удалось загрузить шрифт.");
    const fontFor = (char: string): PDFFont =>
      fonts.find((font) =>
        font.getCharacterSet().includes(char.codePointAt(0) ?? 0),
      ) ?? fallback;
    const width = (text: string, size: number) =>
      Array.from(text).reduce(
        (sum, char) => sum + fontFor(char).widthOfTextAtSize(char, size),
        0,
      );
    let page = document.addPage([595.28, 841.89]);
    let y = 794;
    const ink = rgb(0.125, 0.18, 0.16);
    const draw = (text: string, x: number, at: number, size: number) => {
      let run = "";
      let active = fallback;
      const flush = () => {
        if (!run) return;
        page.drawText(run, { x, y: at, size, font: active, color: ink });
        x += active.widthOfTextAtSize(run, size);
        run = "";
      };
      for (const char of text) {
        const font = fontFor(char);
        if (font !== active) {
          flush();
          active = font;
        }
        run += char;
      }
      flush();
    };
    const paragraph = (value: string, size = 12, gap = 10) => {
      let line = "";
      for (const char of value.replace(/\s+/gu, " ")) {
        if (width(line + char, size) > 491) {
          write(line, size);
          line = "";
        }
        line += char;
      }
      if (line) write(line, size);
      y -= gap;
    };
    const write = (line: string, size: number) => {
      if (y < 270) {
        page = document.addPage([595.28, 841.89]);
        y = 794;
      }
      draw(line.trim(), 52, y, size);
      y -= size * 1.5;
    };
    paragraph("Пульс — цифровой деканат", 18, 16);
    paragraph(
      "Вымышленная справка конкурсного концепта MGIMO×AI Challenge.",
      13,
      0,
    );
    paragraph("Не является официальным документом.", 13, 20);
    paragraph(`Справка № ${data.number}`, 20, 6);
    paragraph(data.type, 14, 16);
    if (data.revoked) paragraph("ОТОЗВАНА", 16, 12);
    paragraph(`ФИО: ${data.fullName}`);
    paragraph(`Факультет: ${data.faculty}`);
    paragraph(`Направление: ${data.program}`);
    paragraph(`Курс: ${data.course} · Группа: ${data.group}`);
    paragraph(`Место требования: ${data.destination}`);
    paragraph(`Дата выдачи: ${formatCertificateDate(data.issuedAt)} (МСК)`);
    const qr = await document.embedPng(qrPng);
    page.drawImage(qr, { x: 46, y: 70, width: 138, height: 138 });
    draw("Проверка справки", 204, 184, 13);
    page.node.addAnnot(
      document.context.register(
        document.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [46, 70, 540, 208],
          Border: [0, 0, 0],
          A: {
            Type: "Action",
            S: "URI",
            URI: PDFString.of(data.verificationUrl),
          },
        }),
      ),
    );
    draw("Наведите камеру на QR-код.", 204, 158, 11);
    draw("На странице — только минимум данных.", 204, 136, 11);
    draw("Все данные вымышлены.", 52, 42, 10);
    document.setTitle(`Вымышленная справка ${data.number}`);
    document.setAuthor("Пульс — конкурсный концепт");
    return document.save();
  }
}
