import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AssistantJournalEntryDto } from "@/application/assistant/get-my-journal";
import { AssistantJournal } from "@/ui/assistant/journal";

describe("Вывод журнала ассистента", () => {
  it("экранирует HTML вопроса и показывает московские дату и время при смене суток", () => {
    const entry: AssistantJournalEntryDto = {
      at: "2026-11-04T22:15:00.000Z",
      question: '<img src=x onerror="window.JOURNAL_XSS=true"> **текст**',
      questionLabel: "question",
      questionCode: null,
      assistantAction: "answered",
      studentDecision: null,
      sources: [],
    };
    const html = renderToStaticMarkup(
      createElement(AssistantJournal, { entries: [entry] }),
    );
    expect(html).toContain("&lt;img src=x");
    expect(html).not.toContain("<img");
    expect(html).toContain("**текст**");
    expect(html).toContain('dateTime="2026-11-04T22:15:00.000Z"');
    expect(html).toContain("5 ноября 2026 г. в 01:15 МСК");
    expect(html).toContain('tabindex="0"');
  });
  it.each([
    [
      "confirm_submission",
      "confirm",
      "submitted",
      "requestSubmitted",
      "Подтвердить отправку",
      "Заявка подана",
    ],
    [
      "decline_submission",
      "decline",
      "declined",
      "draftRetained",
      "Не отправлять",
      "Не отправлено, черновик сохранён",
    ],
  ] as const)(
    "показывает код нажатия %s как русское действие",
    (question, questionCode, assistantAction, decisionCode, label, decisionText) => {
      const entry: AssistantJournalEntryDto = {
        at: "2026-11-04T22:15:00.000Z",
        question,
        questionLabel: "action",
        questionCode,
        assistantAction,
        studentDecision: { code: decisionCode },
        sources: [],
      };
      const html = renderToStaticMarkup(
        createElement(AssistantJournal, { entries: [entry] }),
      );
      expect(html).toContain("Ваше действие");
      expect(html).toContain(label);
      expect(html).not.toContain(question);
      expect(html).not.toContain("Ваш вопрос");
      expect(html).toContain("Ваше решение");
      expect(html).toContain(decisionText);
    },
  );

  it("переводит кодовые действия и решения на английский, сохраняя пользовательский вопрос и источник", () => {
    const entries: AssistantJournalEntryDto[] = [
      {
        at: "2026-11-04T22:15:00.000Z",
        question: "Что со стипендией?",
        questionLabel: "question",
        questionCode: null,
        assistantAction: "answered",
        studentDecision: null,
        sources: [
          { href: "/regulations/scholarship#p-2", label: "Стипендии · § 2" },
        ],
      },
      {
        at: "2026-11-04T22:16:00.000Z",
        question: "confirm_submission",
        questionLabel: "action",
        questionCode: "confirm",
        assistantAction: "submitted",
        studentDecision: { code: "requestSubmitted", href: "/requests" },
        sources: [],
      },
    ];
    const html = renderToStaticMarkup(
      createElement(AssistantJournal, { entries, language: "en" }),
    );
    expect(html).toContain("Your question");
    expect(html).toContain("Что со стипендией?");
    expect(html).toContain("Стипендии · § 2");
    expect(html).toContain("Your action");
    expect(html).toContain("Confirm submission");
    expect(html).toContain("Submitted the request after your confirmation");
    expect(html).toContain("Request submitted");
    expect(html).toContain('href="/requests"');
    expect(html).toContain("5 November 2026 at 01:15 MSK");
    expect(html).not.toContain("confirm_submission");
    expect(html).not.toContain("Ваше действие");
  });
});
