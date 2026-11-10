import { readFile } from "node:fs/promises";
import { join } from "node:path";

const latin = () =>
  readFile(
    join(process.cwd(), "src/infrastructure/pdf/fonts/GolosText-Latin.woff"),
  );
const cyrillic = () =>
  readFile(
    join(process.cwd(), "src/infrastructure/pdf/fonts/GolosText-Cyrillic.woff"),
  );

let fonts: Promise<[Buffer, Buffer]> | undefined;
export function certificateFonts() {
  // Trace the license with the fonts so standalone images retain the OFL.
  fonts ??= Promise.all([
    latin(),
    cyrillic(),
    readFile(join(process.cwd(), "src/infrastructure/pdf/fonts/OFL.txt")),
  ]).then(([latinFont, cyrillicFont]) => [latinFont, cyrillicFont]);
  return fonts;
}

let tokens: Promise<string> | undefined;
export function verificationTokens() {
  // Share the existing tokens without duplicating their values in standalone HTML.
  tokens ??= readFile(join(process.cwd(), "src/app/globals.css"), "utf8").then(
    (css) => {
      const root = css.match(/:root\s*\{[^}]+\}/)?.[0];
      if (!root) throw new Error("Не найдены токены оформления.");
      const theme = css.match(/@theme inline\s*\{([^}]+)\}/)?.[1];
      if (!theme) throw new Error("Не найдены токены типографики.");
      return `${root}:root {${theme}}`;
    },
  );
  return tokens;
}
