import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { calculateWhatIf } from "@/application/grades/calculation";
import { GetMyGrades } from "@/application/grades/get-my-grades";
import { calculateScholarship } from "@/application/grades/scholarship";
import { ScholarshipCard } from "@/ui/grades/scholarship-forecast";
import {
  scholarshipBlockerMessage,
  scholarshipMessage,
} from "@/ui/grades/scholarship-message";
import { WhatIf } from "@/ui/grades/what-if";
import { LanguageProvider } from "@/ui/i18n/language-provider";
import { gradesFixture } from "../fakes/grades";

it("коды прогноза не содержат готовых фраз, UI сохраняет русское представление и переводит английское", async () => {
  const d = gradesFixture();
  const data = await new GetMyGrades(d.repository, d.clock).executeMessages(
    d.anna,
  );
  const outlook = data.scholarship.outlook;
  expect(outlook).not.toHaveProperty("label");
  expect(outlook).not.toHaveProperty("headline");
  expect(outlook).toMatchObject({
    state: "at-risk",
    currentScholarship: "increased",
    requirement: { minimum: 77, maxScore: 100 },
  });
  expect(scholarshipMessage(outlook, "ru").headline).toBe(
    "Повышенная стипендия под угрозой: нужно не меньше 77 из 100 за «Итоговый тест» по дисциплине «Иностранный язык».",
  );
  expect(scholarshipMessage(outlook, "en").headline).toBe(
    "Increased scholarship is at risk: you need at least 77 out of 100 for «Итоговый тест» in «Иностранный язык».",
  );
  expect(
    data.scholarship.blockers.every((item) => !Object.hasOwn(item, "reason")),
  ).toBe(true);
  expect(JSON.parse(JSON.stringify(data.scholarship))).toEqual(
    data.scholarship,
  );
});

it("английский SSR стипендии и симуляции оставляет названия из БД и меняет десятичный разделитель", async () => {
  const d = gradesFixture();
  const data = await new GetMyGrades(d.repository, d.clock).executeMessages(
    d.anna,
  );
  const course = data.courses.find((item) => item.title === "Иностранный язык");
  if (course?.calculationStatus !== "ready")
    throw new Error("Нет вымышленной дисциплины.");
  const props = {
    language: "en" as const,
    children: createElement(
      "div",
      null,
      createElement(ScholarshipCard, { forecast: data.scholarship }),
      createElement(WhatIf, {
        course,
        target: data.targetScore,
        semester: data,
      }),
    ),
  };
  const html = renderToStaticMarkup(createElement(LanguageProvider, props));
  expect(html).toContain("Increased scholarship is at risk");
  expect(html).toContain("Increased scholarship is retained.");
  expect(html).toContain("What if?");
  expect(html).toContain("Submit with 77 out of 100");
  expect(html).toContain("Current: 78.3 out of 100");
  expect(html).toContain("Иностранный язык");
  expect(html).toContain("Итоговый тест");
  expect(html).toContain("Scholarship rules");
  expect(html).not.toContain("Что если?");
});

it("причины препятствий переводятся только по закрытым кодам", () => {
  expect(
    scholarshipBlockerMessage(
      { courseId: "course", title: "Не переводится", code: "debt" },
      "en",
    ),
  ).toBe("Outstanding required assignment");
  expect(
    scholarshipBlockerMessage(
      { courseId: "course", title: "Не переводится", code: "clarification" },
      "en",
    ),
  ).toBe("Course data needs clarification");
  expect(
    scholarshipBlockerMessage(
      {
        courseId: "course",
        title: "Не переводится",
        code: "below-threshold",
        threshold: 86,
        grade: { code: "good", credit: true },
      },
      "en",
    ),
  ).toBe("Total below 86 — good");
});

it("точная граница 86 при нескольких слагаемых сохраняется в коде оценки и стипендии", () => {
  const works = [77, 99, 68].map((score, index) => ({
    id: `work-${index}`,
    title: `Работа ${index}`,
    score,
    weight: index === 2 ? 10 : 45,
    maxScore: 100,
    dueAt: "2026-11-10T10:00:00Z",
    isRequired: true,
    status: "graded",
  }));
  const result = calculateWhatIf(works, {}, 86);
  expect(result.total).toBe(86);
  expect(result.grade).toEqual({ code: "excellent", credit: true });
  expect(result.reachesTarget).toBe(true);
  const forecast = calculateScholarship(
    [{ id: "course", title: "Дисциплина", works, exams: [], openDebts: 0 }],
    "increased",
  );
  expect(forecast.level).toBe("increased");
  expect(scholarshipMessage(forecast.outlook, "en")).toEqual({
    label: "Retained",
    headline: "Increased scholarship is retained.",
  });
  expect(forecast.blockers).toEqual([]);
});
