export interface RegulationChunk {
  section: string;
  title: string;
  body: string;
}

export function sectionAnchor(section: string): string {
  return `p-${section.replaceAll(".", "-")}`;
}

export function compareSections(left: string, right: string): number {
  const a = left.split(".");
  const b = right.split(".");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x !== y) return x.length - y.length || (x < y ? -1 : 1);
  }
  return 0;
}

export function parseRegulationMarkdown(markdown: string): RegulationChunk[] {
  const lines = markdown.replaceAll("\r\n", "\n").trim().split("\n");
  const title = /^#\s+(.+?)\s*$/.exec(lines.shift() ?? "")?.[1]?.trim();
  if (!title) throw new Error("У положения должен быть один заголовок #.");
  let current: RegulationChunk = { section: "0", title, body: "" };
  const chunks: RegulationChunk[] = [current];
  const numbers = new Set(["0"]);
  let fence: string | undefined;
  for (const line of lines) {
    const delimiter = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (delimiter && !fence) fence = delimiter;
    else if (
      delimiter &&
      fence &&
      delimiter[0] === fence[0] &&
      delimiter.length >= fence.length
    )
      fence = undefined;
    if (!fence && !delimiter && /^\s*#/.test(line)) {
      const heading =
        /^#{2,6}\s+((?:[1-9]\d*)(?:\.[1-9]\d*)*)\s+(.+?)\s*$/.exec(line);
      const sectionTitle = heading?.[2]?.trim();
      if (!heading?.[1] || !sectionTitle)
        throw new Error(`Некорректный номер или заголовок пункта: ${line}`);
      const section = heading[1];
      if (numbers.has(section))
        throw new Error(`Повторный номер пункта: ${section}`);
      numbers.add(section);
      current = { section, title: sectionTitle, body: "" };
      chunks.push(current);
    } else {
      current.body += `${line}\n`;
    }
  }
  if (fence) throw new Error("Не закрыт блок кода в положении.");
  for (const chunk of chunks) {
    chunk.body = chunk.body.trim();
    if (!chunk.body) throw new Error(`Пустой пункт: ${chunk.section}`);
  }
  if (!chunks[0]?.body.startsWith("Вымышленное положение конкурсного концепта"))
    throw new Error(
      "Преамбула должна начинаться с пометки о вымышленном положении.",
    );
  if (chunks.length < 2)
    throw new Error("В положении нет нумерованных пунктов.");
  return chunks;
}
