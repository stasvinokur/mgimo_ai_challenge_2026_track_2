import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
} from "pdf-lib";

// Decode the compressed content and embedded ToUnicode maps, not metadata.
export async function certificatePdfText(bytes: Uint8Array) {
  const document = await PDFDocument.load(bytes);
  let text = "";
  for (const page of document.getPages()) {
    const fonts = page.node.Resources()?.lookup(PDFName.of("Font"), PDFDict);
    if (!fonts) throw new Error("В PDF нет шрифтов.");
    const maps = new Map<string, Map<string, string>>();
    for (const [name, ref] of fonts.entries()) {
      const font = document.context.lookup(ref, PDFDict);
      const cmap = font.lookup(PDFName.of("ToUnicode"));
      if (!(cmap instanceof PDFRawStream))
        throw new Error("Нет карты Unicode.");
      const source = Buffer.from(decodePDFRawStream(cmap).decode()).toString(
        "utf8",
      );
      const map = new Map<string, string>();
      const characters =
        source.split("beginbfchar")[1]?.split("endbfchar")[0] ?? "";
      for (const match of characters.matchAll(
        /<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi,
      )) {
        const glyph = match[1];
        const unicode = match[2];
        if (glyph && unicode)
          map.set(
            glyph.toUpperCase(),
            String.fromCharCode(
              ...(unicode.match(/.{4}/g) ?? []).map((hex) =>
                Number.parseInt(hex, 16),
              ),
            ),
          );
      }
      maps.set(name.toString().slice(1), map);
    }
    const contents = page.node.Contents();
    const streams =
      contents instanceof PDFArray ? contents.asArray() : [contents];
    let active = "";
    for (const ref of streams) {
      const stream = document.context.lookup(ref);
      if (!(stream instanceof PDFRawStream))
        throw new Error("Нет текстового потока.");
      const content = Buffer.from(decodePDFRawStream(stream).decode()).toString(
        "utf8",
      );
      for (const match of content.matchAll(
        /\/([^\s]+)\s+[\d.]+\s+Tf|<([0-9a-f]+)>\s*Tj/gi,
      )) {
        if (match[1]) active = match[1];
        else
          for (const glyph of match[2]?.match(/.{4}/g) ?? [])
            text += maps.get(active)?.get(glyph.toUpperCase()) ?? "�";
      }
    }
    text += "\n";
  }
  return text;
}
