import { expect, it } from "vitest";
import type { SearchContextDto } from "@/application/search/dto";
import { searchMessages } from "@/ui/i18n/dictionaries/search";
import { t } from "@/ui/i18n/translate";
import {
  formatSearchContext,
  formatSearchTitle,
} from "@/ui/search/format-result";

it("дата результата идёт по языку и Москве на границе UTC-дня", () => {
  const context: SearchContextDto = {
    code: "schedule",
    startsAt: "2026-11-04T21:30:00Z",
    teacher: "Артём Дёмин",
    room: "ДЕМО-102",
    status: "scheduled",
  };
  expect(formatSearchContext("ru", context)).toBe(
    "5 ноября · 00:30 · Артём Дёмин · ауд. ДЕМО-102",
  );
  expect(formatSearchContext("en", context)).toBe(
    "5 November · 00:30 · Артём Дёмин · room ДЕМО-102",
  );
  expect(
    formatSearchContext("en", { ...context, status: "cancelled" }),
  ).toContain(" · cancelled");
  expect(
    formatSearchContext("en", { ...context, status: "moved-from" }),
  ).toContain(" · rescheduled");
  expect(
    formatSearchContext("en", { ...context, status: "moved-to" }),
  ).not.toContain("rescheduled");
});

it("оценка, срок и отсутствие оценки переводятся из кодов, без расчёта в UI", () => {
  const context: SearchContextDto = {
    code: "work",
    course: "Политическая география",
    score: 23.5,
    maxScore: 30,
    dueAt: "2026-11-04T21:30:00Z",
  };
  expect(formatSearchContext("ru", context)).toBe(
    "Политическая география · 23,5 из 30 · срок 5 ноября",
  );
  expect(formatSearchContext("en", context)).toBe(
    "Политическая география · 23.5 out of 30 · due 5 November",
  );
  expect(formatSearchContext("en", { ...context, score: null })).toContain(
    "not graded yet",
  );
});

it("заголовки и контексты из БД сохраняются, а названия состояний переводятся", () => {
  expect(formatSearchTitle("en", "Справка об обучении")).toBe(
    "Справка об обучении",
  );
  expect(
    formatSearchTitle("en", {
      code: "request",
      publicNo: "З-2026-000002",
      typeTitle: "Справка об обучении",
    }),
  ).toBe("З-2026-000002 · Справка об обучении");
  expect(
    formatSearchTitle("en", {
      code: "request",
      publicNo: null,
      typeTitle: null,
    }),
  ).toBe("Draft · Request");
  expect(
    formatSearchTitle("ru", {
      code: "request",
      publicNo: null,
      typeTitle: null,
    }),
  ).toBe("Черновик · Заявка");
  const statuses = [
    "draft",
    "submitted",
    "accepted",
    "in_progress",
    "needs_info",
    "ready",
    "issued",
    "rejected",
    "cancelled",
  ] as const;
  for (const language of ["ru", "en"] as const) {
    for (const status of statuses)
      expect(formatSearchContext(language, { code: "request", status })).toBe(
        t(language, searchMessages, "ownRequest", {
          status: t(language, searchMessages, status),
        }),
      );
    expect(
      formatSearchContext(language, {
        code: "requestType",
        description: "Учебный документ",
      }),
    ).toContain("Учебный документ");
    expect(
      formatSearchContext(language, {
        code: "regulation",
        documentTitle: "Порядок выдачи",
        section: "3.2",
        excerpt: "Срок [[[выдачи]]]",
      }),
    ).toBe("Порядок выдачи · § 3.2 · Срок [[[выдачи]]]");
  }
});

it("новые ключи словаря полны, а параметры совпадают для обоих языков", () => {
  for (const message of Object.values(searchMessages)) {
    expect(message.ru.trim()).not.toBe("");
    expect(message.en.trim()).not.toBe("");
    const params = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    expect(params(message.en)).toEqual(params(message.ru));
  }
});
