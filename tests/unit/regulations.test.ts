import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  compareSections,
  parseRegulationMarkdown,
  sectionAnchor,
} from "@/domain/regulations/markdown";
import {
  internalRegulationUrl,
  RegulationExcerpt,
  RegulationMarkdown,
} from "@/ui/regulations/markdown";
import { requestFixtures } from "../../scripts/fixtures/requests";
import { fixtureContext } from "../../scripts/fixtures/shared";
import { FakeClock } from "../fakes/clock";
import { SequentialIdGenerator } from "../fakes/id-generator";

const preamble = "# Правила\n\nВымышленное положение конкурсного концепта.\n\n";

it("parser: заголовки, преамбула, вложенные номера и markdown сохраняются", () => {
  const chunks = parseRegulationMarkdown(
    `${preamble}## 2 Стипендии\n\n**Правило**.\n\n### 3.2 Справки\n\n[Ссылка](/requests)\n`,
  );
  expect(chunks).toEqual([
    {
      section: "0",
      title: "Правила",
      body: "Вымышленное положение конкурсного концепта.",
    },
    { section: "2", title: "Стипендии", body: "**Правило**." },
    { section: "3.2", title: "Справки", body: "[Ссылка](/requests)" },
  ]);
  expect(sectionAnchor("3.2.1")).toBe("p-3-2-1");
  expect(["10", "2.10", "2.2", "2", "3"].sort(compareSections)).toEqual([
    "2",
    "2.2",
    "2.10",
    "3",
    "10",
  ]);
});

it("заголовки внутри блока кода не создают пункты; поддерживаются CRLF", () => {
  const text = `${preamble}## 1 Пример\n\n\`\`\`md\n## 2 Не пункт\n\`\`\`\n`;
  expect(parseRegulationMarkdown(text.replaceAll("\n", "\r\n"))).toHaveLength(
    2,
  );
});

it.each([
  "## Без номера\nТекст",
  "##  Пустой номер\nТекст",
  "## 2\nТекст",
  "## 2 \nТекст",
  "## 2    \nТекст",
  "## 2 \t \nТекст",
  "## 0 Резерв\nТекст",
  "## 02 Ноль\nТекст",
  "## 3..2 Ошибка\nТекст",
  "## 3.2. Ошибка\nТекст",
  "## 2 Пустой\n",
  "## 2 Первый\nТекст\n## 2 Повтор\nТекст",
  "## 2 Первый\nТекст\n### 3.2 Первый\nТекст\n### 3.2 Повтор\nТекст",
  "## 1 Код\n\n```\nНезакрытый блок",
  "# Второй документ\nТекст",
  "",
])("повреждённый пункт останавливает parser: %s", (body) => {
  expect(() => parseRegulationMarkdown(preamble + body)).toThrow();
});

it("нужны заголовок документа и пометка о вымышленности", () => {
  expect(() => parseRegulationMarkdown("## 2 Пункт\nТекст")).toThrow();
  expect(() =>
    parseRegulationMarkdown("# Документ\nОбычное правило\n## 1 Пункт\nТекст"),
  ).toThrow();
  expect(() =>
    parseRegulationMarkdown(
      "#    \nВымышленное положение конкурсного концепта.\n## 1 Пункт\nТекст",
    ),
  ).toThrow();
});

it("корпус содержит 8 документов; каталог, сроки и пороги согласованы", () => {
  const directory = new URL("../../content/regulations/", import.meta.url);
  const files = readdirSync(directory).filter(
    (f) => f.endsWith(".md") && f !== "README.md",
  );
  expect(files).toHaveLength(8);
  for (const file of files)
    expect(
      parseRegulationMarkdown(readFileSync(new URL(file, directory), "utf8"))
        .length,
    ).toBeGreaterThan(2);
  const certificates = readFileSync(
    new URL("certificates.md", directory),
    "utf8",
  );
  const ctx = fixtureContext(
    new FakeClock("2026-11-04T09:00:00Z"),
    new SequentialIdGenerator(),
  );
  const chunks = parseRegulationMarkdown(certificates);
  for (const type of requestFixtures(ctx).requestTypes) {
    const typeChunks =
      type.code === "event_release"
        ? parseRegulationMarkdown(
            readFileSync(new URL("attendance.md", directory), "utf8"),
          )
        : chunks;
    const chunk = typeChunks.find((c) =>
      `${c.title} ${c.body}`.includes(type.title),
    );
    expect(`${chunk?.title} ${chunk?.body}`).toContain(type.title);
    expect(chunk?.body).toMatch(new RegExp(`${type.slaWorkDays} рабочих дн`));
    if (type.code === "event_release") {
      expect(chunk?.section).toBe("4");
      expect(chunk?.body).toContain("14 календарных дней");
    } else
      expect(chunk?.body).toContain(type.delivery === "pdf" ? "PDF" : "лично");
    expect(certificates).not.toContain(`\`${type.code}\``);
  }
  const scholarship = parseRegulationMarkdown(
    readFileSync(new URL("scholarship.md", directory), "utf8"),
  ).find((c) => c.section === "2");
  expect(scholarship?.body).toContain("не ниже 86");
  expect(scholarship?.body).toContain("без академических долгов");
  const grading = readFileSync(new URL("assessment.md", directory), "utf8");
  for (const threshold of ["55", "70", "86", "100"])
    expect(grading).toContain(threshold);
});

describe("безопасный markdown", () => {
  it("script, img onerror, HTML и опасные ссылки не становятся разметкой", () => {
    const html = renderToStaticMarkup(
      createElement(
        RegulationMarkdown,
        null,
        '<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">\n\n[опасно](javascript:alert)\n\n[внешняя](https://example.org)\n\n[внутренняя](/regulations/scholarship#p-2)',
      ),
    );
    expect(html).not.toMatch(
      /<script|<img|onerror=|javascript:|https:\/\/example/,
    );
    expect(html).toContain('href="/regulations/scholarship#p-2"');
  });
  it.each([
    "https://example.org",
    "//example.org",
    "/\\example.org",
    "javascript:alert(1)",
    "data:text/html,x",
    "/\n/example.org",
  ])("ссылка %s блокируется", (url) => {
    expect(internalRegulationUrl(url)).toBeUndefined();
  });
  it("поисковые маркеры рисуют mark, весь текст экранируется", () => {
    const html = renderToStaticMarkup(
      createElement(
        "p",
        {},
        createElement(RegulationExcerpt, {
          text: '[[[Справка]]]<img onerror="alert(1)">',
        }),
      ),
    );
    expect(html).toContain("<mark");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
  });
});

it("над динамическим slug нет loading-границы", () => {
  for (const path of [
    "src/app",
    "src/app/(student)",
    "src/app/(student)/regulations",
    "src/app/(student)/regulations/[slug]",
  ]) {
    expect(readdirSync(path).filter((name) => /^loading\./.test(name))).toEqual(
      [],
    );
  }
  expect(readdirSync("src/app/(student)/regulations/(list)")).toContain(
    "loading.tsx",
  );
});
