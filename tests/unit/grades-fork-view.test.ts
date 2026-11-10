import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { WorkOutcomesDto } from "@/application/grades/calculation";
import { OutcomeFork } from "@/ui/grades/outcome-fork";

const outcomes: WorkOutcomesDto = {
  currentTotal: 78.3,
  target: 86,
  maxScore: 100,
  submitted: {
    score: 77,
    total: 86,
    grade: { code: "excellent", credit: true },
    reachesTarget: true,
  },
  skipped: {
    total: 78.3,
    grade: { code: "good", credit: true },
    reachesTarget: false,
  },
};

function branch(html: string, key: "submit" | "skip") {
  const start = html.indexOf(`data-testid="fork-${key}"`);
  const end =
    key === "submit"
      ? html.indexOf('data-testid="fork-skip"', start)
      : html.length;
  return html.slice(start, end);
}

it("оба исхода доступны видимым текстом рядом со скрытыми от читалки SVG", () => {
  const html = renderToStaticMarkup(createElement(OutcomeFork, { outcomes }));
  expect(html).toContain("Сейчас: 78,3 из 100");
  const submit = branch(html, "submit");
  expect(submit).toContain("Сдать на 77 из 100");
  expect(submit).toContain("Итог 86 из 100");
  expect(submit).toContain("отлично");
  expect(submit).toContain("Цель ≥ 86: достигнута в расчёте");
  const skip = branch(html, "skip");
  expect(skip).toContain("Пропустить");
  expect(skip).toContain("Итог 78,3 из 100");
  expect(skip).toContain("хорошо");
  expect(skip).toContain("Цель ≥ 86: пока не достигнута");
  const graphics = html.match(/<svg\b[^>]*>[\s\S]*?<\/svg>/g);
  expect(graphics).toHaveLength(2);
  for (const svg of graphics ?? []) {
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('focusable="false"');
    expect(svg).not.toContain("Итог");
    expect(svg).not.toContain("Сдать");
  }
  expect(html).not.toContain("sr-only");
});

it.each(["submit", "skip"] as const)(
  "выбор %s выделен и текстовой меткой, и токенами темы",
  (selected) => {
    const html = renderToStaticMarkup(
      createElement(OutcomeFork, { outcomes, selected }),
    );
    const active = branch(html, selected);
    const inactive = branch(html, selected === "submit" ? "skip" : "submit");
    expect(active).toContain('data-selected="true"');
    expect(active).toContain("Выбрано");
    expect(active).toContain("border-primary");
    expect(inactive).toContain('data-selected="false"');
    expect(inactive).not.toContain("Выбрано");
    expect(html.match(/Выбрано/g)).toHaveLength(1);
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
  },
);

it("компактная развилка показывает те же исходы без фиктивно выбранной ветки", () => {
  const full = renderToStaticMarkup(createElement(OutcomeFork, { outcomes }));
  const compact = renderToStaticMarkup(
    createElement(OutcomeFork, { outcomes, compact: true }),
  );
  const text = (html: string) => html.replace(/<[^>]+>/g, "");
  expect(text(compact)).toBe(text(full));
  expect(compact).toContain('data-compact="true"');
  expect(compact).not.toContain("Выбрано");
});

it("показанное значение остаётся настоящим даже за пределами визуальной шкалы", () => {
  const html = renderToStaticMarkup(
    createElement(OutcomeFork, {
      outcomes: {
        ...outcomes,
        currentTotal: 101.25,
        target: 86.5,
        submitted: { ...outcomes.submitted, total: 110.75 },
        skipped: { ...outcomes.skipped, total: -2.5 },
      },
    }),
  );
  expect(html).toContain("Сейчас: 101,25 из 100");
  expect(branch(html, "submit")).toContain("Итог 110,75 из 100");
  expect(branch(html, "skip")).toContain("Итог -2,5 из 100");
  expect(html).toContain("Цель ≥ 86,5");
});
