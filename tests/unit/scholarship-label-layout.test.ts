import { expect, it } from "vitest";
import { countScholarshipTextLines } from "../e2e/scholarship-label-layout";

it("однострочная подпись внутри кнопки 44 px остаётся одной строкой", () => {
  expect(countScholarshipTextLines([{ top: 14, bottom: 30 }])).toBe(1);
});

it("несколько текстовых узлов в одной строке не считаются переносом", () => {
  expect(
    countScholarshipTextLines([
      { top: 14, bottom: 30 },
      { top: 14.25, bottom: 30.25 },
      { top: 15, bottom: 29 },
    ]),
  ).toBe(1);
});

it("подпись на двух строках допустима независимо от высоты области касания", () => {
  expect(
    countScholarshipTextLines([
      { top: 4, bottom: 20 },
      { top: 24, bottom: 40 },
    ]),
  ).toBe(2);
});

it("три строки не маскируются min-height или обрезанной высотой кнопки", () => {
  const lines = countScholarshipTextLines([
    { top: 4, bottom: 20 },
    { top: 24, bottom: 40 },
    { top: 44, bottom: 60 },
  ]);
  expect(lines).toBe(3);
  expect(lines <= 2).toBe(false);
});

it("порядок текстовых узлов и фрагменты на границе строк не склеивают строки", () => {
  expect(
    countScholarshipTextLines([
      { top: 24, bottom: 40 },
      { top: 8, bottom: 24 },
      { top: 4, bottom: 20 },
      { top: 25, bottom: 39 },
    ]),
  ).toBe(2);
});

it("нулевые прямоугольники скрытого текста не создают строк", () => {
  expect(countScholarshipTextLines([{ top: 0, bottom: 0 }])).toBe(0);
});
