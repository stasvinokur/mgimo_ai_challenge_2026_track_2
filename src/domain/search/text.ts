export function normalizeSearchText(text: string): string {
  return text.toLowerCase().replaceAll("ё", "е").replace(/\s+/gu, " ").trim();
}

export interface SearchTextPart {
  text: string;
  matched: boolean;
}

export function splitSearchText(text: string, query: string): SearchTextPart[] {
  const needle = normalizeSearchText(query);
  if (!needle) return [{ text, matched: false }];
  let normalized = "";
  const offsets: { start: number; end: number }[] = [];
  let start = 0;
  for (const char of text) {
    const end = start + char.length;
    const value = /\s/u.test(char)
      ? " "
      : char.toLowerCase().replaceAll("ё", "е");
    if (value === " " && normalized.endsWith(" ")) {
      const previous = offsets.at(-1);
      if (previous) previous.end = end;
    } else {
      normalized += value;
      for (let i = 0; i < value.length; i++) offsets.push({ start, end });
    }
    start = end;
  }
  const parts: SearchTextPart[] = [];
  let cursor = 0;
  let from = 0;
  for (;;) {
    const index = normalized.indexOf(needle, from);
    if (index < 0) break;
    const first = offsets[index];
    const last = offsets[index + needle.length - 1];
    if (!first || !last) break;
    if (first.start > cursor)
      parts.push({ text: text.slice(cursor, first.start), matched: false });
    parts.push({ text: text.slice(first.start, last.end), matched: true });
    cursor = last.end;
    from = index + needle.length;
  }
  if (cursor < text.length || parts.length === 0)
    parts.push({ text: text.slice(cursor), matched: false });
  return parts;
}

export function splitMarkedText(text: string): SearchTextPart[] {
  const parts: SearchTextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/\[\[\[([\s\S]*?)\]\]\]/g)) {
    parts.push({ text: text.slice(cursor, match.index), matched: false });
    parts.push({ text: match[1] ?? "", matched: true });
    cursor = match.index + match[0].length;
  }
  parts.push({ text: text.slice(cursor), matched: false });
  return parts;
}

export function searchExcerpt(text: string, query: string): string {
  const parts = splitSearchText(text, query);
  let index = 0;
  for (const part of parts) {
    if (part.matched) break;
    index += part.text.length;
  }
  const start = index < text.length ? Math.max(0, index - 40) : 0;
  const end = start + 180;
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}
