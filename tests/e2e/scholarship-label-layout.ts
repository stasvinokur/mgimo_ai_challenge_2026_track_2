export interface TextLineRect {
  top: number;
  bottom: number;
}

export function countScholarshipTextLines(rects: readonly TextLineRect[]) {
  const rows: TextLineRect[] = [];
  for (const rect of [...rects].sort((left, right) => left.top - right.top)) {
    if (rect.bottom <= rect.top) continue;
    const row = rows.find(
      (item) =>
        Math.min(item.bottom, rect.bottom) > Math.max(item.top, rect.top),
    );
    if (row) {
      row.top = Math.max(row.top, rect.top);
      row.bottom = Math.min(row.bottom, rect.bottom);
    } else rows.push({ ...rect });
  }
  return rows.length;
}

export function measureScholarshipLabel(element: HTMLElement) {
  const style = getComputedStyle(element);
  const box = element.getBoundingClientRect();
  const textRects: TextLineRect[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (
      !node.textContent?.trim() ||
      !parent ||
      parent.closest('.sr-only, [aria-hidden="true"]') ||
      getComputedStyle(parent).visibility !== "visible"
    )
      continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width > 0 && rect.height > 0)
        textRects.push({ top: rect.top, bottom: rect.bottom });
    }
  }
  return {
    text: element.textContent,
    isButton: element.tagName === "BUTTON",
    width: box.width,
    height: box.height,
    minHeight: Number.parseFloat(style.minHeight),
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    lineHeight: Number.parseFloat(style.lineHeight),
    textRects,
    wrap: style.overflowWrap,
    whitespace: style.whiteSpace,
    wordBreak: style.wordBreak,
  };
}
