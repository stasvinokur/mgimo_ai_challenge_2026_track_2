import { describe, expect, it } from "vitest";
import {
  normalizeSearchText,
  splitMarkedText,
  splitSearchText,
} from "@/domain/search/text";

describe("нормализация поиска", () => {
  it.each([
    ["  ЁЛКА\t\n и   ЕЖ ", "елка и еж"],
    ["ДЕМО-102", "демо-102"],
    ["З-2026-000002", "з-2026-000002"],
    [" \u00a0 ", ""],
  ])("%j → %j", (input, output) =>
    expect(normalizeSearchText(input)).toBe(output),
  );
  it("не меняет исходный текст, сохраняет пробелы и повторные совпадения", () => {
    const text = "🌳 Ёлка\t  ЕЖ, ёлка еж.";
    const parts = splitSearchText(text, " ЕЛКА еж ");
    expect(
      parts.filter((part) => part.matched).map((part) => part.text),
    ).toEqual(["Ёлка\t  ЕЖ", "ёлка еж"]);
    expect(parts.map((part) => part.text).join("")).toBe(text);
  });
  it("ищет литерально, не интерпретирует regex/HTML и не подсвечивает пустой запрос", () => {
    expect(
      splitSearchText("<script>.*</script>", ".*").filter(
        (part) => part.matched,
      ),
    ).toEqual([{ text: ".*", matched: true }]);
    expect(splitSearchText("текст", "")).toEqual([
      { text: "текст", matched: false },
    ]);
    expect(splitSearchText("текст", "нет")).toEqual([
      { text: "текст", matched: false },
    ]);
  });
  it("маркеры FTS становятся частями текста, незакрытый маркер остаётся текстом", () => {
    expect(splitMarkedText("До [[[<b>академ</b>]]] после [[[")).toEqual([
      { text: "До ", matched: false },
      { text: "<b>академ</b>", matched: true },
      { text: " после [[[", matched: false },
    ]);
  });
});
