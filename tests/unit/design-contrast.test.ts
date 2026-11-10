import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");
function tokens(selector: string) {
  const start = css.indexOf(`${selector} {`);
  expect(start, `Блок палитры ${selector}`).toBeGreaterThanOrEqual(0);
  const block = css.slice(start).split("}", 1)[0] ?? "";
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6});/gi)].map((match) => [
      match[1],
      match[2],
    ]),
  );
}
function luminance(hex: string) {
  const rgb = [1, 3, 5].map(
    (index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255,
  );
  const linear = rgb.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return (
    (linear[0] ?? 0) * 0.2126 +
    (linear[1] ?? 0) * 0.7152 +
    (linear[2] ?? 0) * 0.0722
  );
}
function contrast(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

// Each added foreground/background role must be listed explicitly here.
const textPairs = [
  ["--foreground", "--background"],
  ["--foreground", "--card"],
  ["--foreground", "--secondary"],
  ["--muted-foreground", "--background"],
  ["--muted-foreground", "--card"],
  ["--muted-foreground", "--secondary"],
  ["--muted-foreground", "--muted"],
  ["--primary", "--background"],
  ["--primary", "--card"],
  ["--primary-foreground", "--primary"],
  ["--accent-foreground", "--accent"],
  ["--destructive-foreground", "--destructive"],
  ["--hero-ink", "--hero"],
  ["--pulse-foreground", "--pulse"],
  ["--pulse-muted", "--pulse"],
  ["--pulse-now-ink", "--pulse-now"],
  ["--success-ink", "--success-bg"],
  ["--warning-ink", "--warning-bg"],
  ["--danger-ink", "--danger-bg"],
  ["--info-ink", "--info-bg"],
] as const;
const graphicPairs = [
  ["--pulse-line", "--pulse"],
  ["--pulse-now", "--pulse"],
  ["--progress-ink", "--card"],
  ["--progress-ink", "--progress-track"],
] as const;

const highContrastTextPairs = [
  ...textPairs,
  ["--foreground", "--accent"],
  ["--muted-foreground", "--accent"],
  ["--foreground", "--info-bg"],
  ["--foreground", "--success-bg"],
  ["--foreground", "--warning-bg"],
  ["--foreground", "--danger-bg"],
  ["--primary", "--secondary"],
  ["--primary", "--muted"],
  ["--primary", "--accent"],
  ["--destructive", "--background"],
  ["--destructive", "--card"],
] as const;

const highContrastGraphicPairs = [
  ...graphicPairs,
  ...[
    "--background",
    "--card",
    "--secondary",
    "--muted",
    "--accent",
    "--hero",
    "--info-bg",
    "--success-bg",
    "--warning-bg",
    "--danger-bg",
  ].flatMap((surface) => [
    ["--border", surface] as const,
    ["--ring", surface] as const,
  ]),
  ["--pulse-now", "--pulse"],
] as const;

it("WCAG формула: чёрный/белый 21:1, одинаковый цвет 1:1", () => {
  expect(contrast("#000000", "#ffffff")).toBe(21);
  expect(contrast("#24664d", "#24664d")).toBe(1);
});
for (const mode of [
  { selector: ":root", text: 4.5, graphic: 3, high: false },
  { selector: ".dark", text: 4.5, graphic: 3, high: false },
  { selector: "html.a11y-high-contrast", text: 7, graphic: 4.5, high: true },
  { selector: ".dark.a11y-high-contrast", text: 7, graphic: 4.5, high: true },
]) {
  describe(`контраст ${mode.selector}`, () => {
    const palette = { ...tokens(":root"), ...tokens(mode.selector) };
    const groups: [readonly (readonly [string, string])[], number][] = [
      [mode.high ? highContrastTextPairs : textPairs, mode.text],
      [mode.high ? highContrastGraphicPairs : graphicPairs, mode.graphic],
    ];
    if (mode.high) {
      it("высокий контраст задаёт все цветовые роли отдельной палитрой", () => {
        expect(Object.keys(tokens(mode.selector)).sort()).toEqual(
          Object.keys(tokens(":root")).sort(),
        );
      });
    }
    for (const [pairs, minimum] of groups) {
      it.each(pairs)("%s на %s", (foreground, background) => {
        const ink = palette[foreground];
        const surface = palette[background];
        expect(ink, foreground).toMatch(/^#[0-9a-f]{6}$/i);
        expect(surface, background).toMatch(/^#[0-9a-f]{6}$/i);
        expect(contrast(ink ?? "", surface ?? "")).toBeGreaterThanOrEqual(
          minimum,
        );
      });
    }
  });
}
