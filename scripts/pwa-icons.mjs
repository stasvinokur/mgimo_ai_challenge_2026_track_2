import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require(
  require.resolve("sharp", { paths: [require.resolve("next")] }),
);
const svg = await readFile(new URL("../public/pulse.svg", import.meta.url));
const css = await readFile(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);
function token(name) {
  const value = css.match(new RegExp(`--${name}: (#[0-9a-f]+);`))?.[1];
  if (!value) throw new Error(`Не найден токен ${name}`);
  return value;
}
const primary = token("primary");
const background = token("background");
for (const size of [192, 512]) {
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(`public/icons/icon-${size}.png`);
}
await sharp(svg)
  .resize(180, 180)
  .flatten({ background: primary })
  .png()
  .toFile("public/icons/apple-touch-icon.png");
const mark = await sharp(svg).resize(384, 384).png().toBuffer();
await sharp({
  create: { width: 512, height: 512, channels: 4, background: primary },
})
  .composite([{ input: mark, left: 64, top: 64 }])
  .png()
  .toFile("public/icons/icon-maskable-512.png");
await writeFile(
  "public/manifest.webmanifest",
  `${JSON.stringify(
    {
      id: "/",
      name: "Пульс — цифровой деканат",
      short_name: "Пульс",
      description:
        "Конкурсный концепт цифрового деканата. Все данные вымышлены.",
      lang: "ru",
      start_url: "/today",
      scope: "/",
      display: "standalone",
      theme_color: background,
      background_color: background,
      icons: [
        {
          src: "/icons/icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/icons/icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/icons/icon-maskable-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    },
    null,
    2,
  )}\n`,
);

const dark = css.slice(css.indexOf(".dark {"));
function darkToken(name) {
  const value = dark.match(new RegExp(`--${name}: (#[0-9a-f]+);`))?.[1];
  if (!value) throw new Error(`Не найден тёмный токен ${name}`);
  return value;
}
await writeFile(
  "public/offline.css",
  `:root { color-scheme: light dark; font-family: Arial, sans-serif; background: ${background}; color: ${token("foreground")}; }
body { margin: 0; padding: 1.5rem; }
main { max-width: 32rem; margin: 3rem auto; }
h1 { font-size: 1.875rem; }
p { line-height: 1.6; }
button, a { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0.25rem 1rem; border: 1px solid currentColor; border-radius: 0.625rem; font: inherit; cursor: pointer; }
button { background: ${primary}; color: ${token("primary-foreground")}; }
nav { display: flex; flex-wrap: wrap; gap: 1rem; margin-top: 1.5rem; }
a { color: inherit; }
:focus-visible { outline: 2px solid currentColor; outline-offset: 4px; }
footer { max-width: 32rem; margin: auto; font-size: 0.75rem; line-height: 1.6; }
@media (prefers-color-scheme: dark) { :root { background: ${darkToken("background")}; color: ${darkToken("foreground")}; } }
`,
);
