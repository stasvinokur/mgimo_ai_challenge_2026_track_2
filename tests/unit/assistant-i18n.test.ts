import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  AssistantCodedMessage,
  DraftCard,
} from "@/application/assistant/ports";
import { AssistantDraftCard } from "@/ui/assistant/chat";
import {
  assistantMessage,
  draftFieldValue,
  workingDays,
} from "@/ui/assistant/presentation";
import { LanguageProvider } from "@/ui/i18n/language-provider";
import { RegulationMarkdown } from "@/ui/regulations/markdown";

vi.mock("next/navigation", () => ({
  usePathname: () => "/today",
  useRouter: () => ({ refresh: vi.fn() }),
}));

const draft: DraftCard = {
  id: "draft-1",
  typeCode: "enrollment",
  title: "Справка об обучении",
  fields: [
    {
      name: "destination",
      title: "Место требования",
      value: "ООО «Учебный центр»",
      required: true,
    },
    { name: "country", title: "Страна", value: "", required: false },
  ],
  slaWorkDays: 3,
  expectedAt: "2026-11-09T22:00:00Z",
  delivery: "pdf",
  href: "/requests/draft-1",
  source: {
    href: "/regulations/certificates#p-3-2",
    documentTitle: "Справки",
    section: "3.2",
    excerpt: "Текст положения",
  },
  canSubmit: true,
  approvalId: "approval-1",
};

describe("Английский интерфейс ассистента", () => {
  it.each(["ru", "en"] as const)(
    "кодовые фрагменты SSE %s сохраняют отдельные абзацы в ответе",
    (language) => {
      const params = {
        course: "Учебная дисциплина",
        room: "204",
        startsAt: "2026-11-05T12:15:00Z",
        endsAt: "2026-11-05T13:45:00Z",
        now: "2026-11-05T12:06:00Z",
        status: "scheduled",
      };
      const resumed =
        "Текст модели сохраняется." +
        [
          { type: "message", code: "interrupted", params: {} },
          { type: "message", code: "changedLesson", params },
          {
            type: "message",
            code: "changedLesson",
            params: { ...params, course: "Вторая дисциплина" },
          },
          { type: "message", code: "unknownAnswer", params: {} },
        ]
          .map((event) =>
            assistantMessage(language, event as AssistantCodedMessage),
          )
          .join("");
      const resumedHtml = renderToStaticMarkup(
        createElement(RegulationMarkdown, null, resumed),
      );
      expect(resumedHtml.match(/<p>/g)).toHaveLength(5);
      expect(resumedHtml).toContain("<p>Текст модели сохраняется.</p>");
      const fallback =
        assistantMessage(language, {
          type: "message",
          code: "fallbackStart",
          params: {},
        }) +
        assistantMessage(language, {
          type: "message",
          code: "nextLesson",
          params,
        });
      const fallbackHtml = renderToStaticMarkup(
        createElement(RegulationMarkdown, null, fallback),
      );
      expect(fallbackHtml.match(/<p>/g)).toHaveLength(2);
    },
  );
  it("переводит карточку, сохраняя дословно введённые значения и данные профиля", () => {
    const content = createElement(AssistantDraftCard, {
      draft,
      profile: {
        fullName: "Вымышленный студент",
        faculty: "Учебный факультет",
        program: "Учебное направление",
        course: 2,
        group: "ДЕМО-21",
        recordBookNo: "DEMO-01",
      },
      profileError: false,
      retryProfile: vi.fn(),
      sent: false,
      disabled: false,
      decided: false,
      onDecision: vi.fn(),
      close: vi.fn(),
    });
    const provider = { language: "en" as const, children: content };
    const html = renderToStaticMarkup(
      createElement(LanguageProvider, provider),
    );
    for (const content of [
      "Enrolment certificate",
      "Recipient · required",
      "Country · optional",
      "Not provided",
      "3 working days",
      "by 10 November 2026",
      "Profile details",
      "Full name",
      "Year 2 · ДЕМО-21",
      "Confirm submission",
      "Do not submit",
      "ООО «Учебный центр»",
      "Вымышленный студент",
      "Учебный факультет",
      "DEMO-01",
    ])
      expect(html).toContain(content);
    expect(html).not.toContain("Место требования");
    expect(html).not.toContain("Подтвердить отправку");
    expect(html).not.toContain('aria-label="Confirm submission"');
  });

  it("даты полей форматируются в UI, неверная дата и свободный текст не исправляются", () => {
    const field = {
      name: "dateFrom",
      title: "Дата с",
      required: true,
      format: "date",
      value: "2026-11-15",
    };
    expect(draftFieldValue("en", field)).toBe("15 November 2026");
    expect(draftFieldValue("ru", field)).toContain("15 ноября 2026");
    expect(draftFieldValue("en", { ...field, value: "2026-11-31" })).toBe(
      "2026-11-31",
    );
    expect(
      draftFieldValue("en", {
        ...field,
        format: undefined,
        value: "Дата «15 ноября»",
      }),
    ).toBe("Дата «15 ноября»");
  });

  it.each([
    [1, "1 рабочий день", "1 working day"],
    [3, "3 рабочих дня", "3 working days"],
    [5, "5 рабочих дней", "5 working days"],
    [21, "21 рабочий день", "21 working days"],
  ])("рабочие дни %s имеют формы обоих языков", (count, ru, en) => {
    expect(workingDays("ru", count)).toBe(ru);
    expect(workingDays("en", count)).toBe(en);
  });

  it("закрытые коды отказа, подтверждения, ошибок и упрощённого режима переводятся", () => {
    const messages: AssistantCodedMessage[] = [
      { type: "message", code: "refused", params: {} },
      { type: "message", code: "submissionDeclined", params: {} },
      {
        type: "message",
        code: "submittedMessage",
        params: { number: "З-2026-000123" },
      },
      { type: "message", code: "fallbackStart", params: {} },
      { type: "message", code: "scheduleUnavailable", params: {} },
      {
        type: "message",
        code: "debts",
        params: { count: 2, courses: "Учебный курс" },
      },
      { type: "message", code: "clarifyEventDates", params: {} },
      { type: "message", code: "noAnswer", params: {} },
    ];
    const text = messages
      .map((event) => assistantMessage("en", event))
      .join("\n");
    for (const content of [
      "your own details",
      "Submission cancelled",
      "Request З-2026-000123 is submitted",
      "Answer without AI",
      "currently unavailable",
      "Overdue items: 2",
      "Учебный курс",
      "exact event dates and year",
      "No answer could be obtained",
    ])
      expect(text).toContain(content);
    expect(text).not.toContain("Черновик");
    expect(text).not.toContain("Подана");
  });

  it("время кодового ответа — московское, статус отмены не обещает начало пары", () => {
    const event: AssistantCodedMessage = {
      type: "message",
      code: "nextLesson",
      params: {
        course: "Учебная дисциплина",
        room: "204",
        startsAt: "2026-11-05T12:15:00Z",
        endsAt: "2026-11-05T13:45:00Z",
        now: "2026-11-05T12:06:00Z",
        status: "scheduled",
      },
    };
    expect(assistantMessage("en", event)).toBe(
      "Next class: Учебная дисциплина. 05/11/2026, 15:15 MSK, in 9 minutes, room 204.",
    );
    expect(assistantMessage("ru", event)).toContain("через 9 минут");
    expect(
      assistantMessage("en", {
        ...event,
        params: { ...event.params, status: "cancelled" },
      }),
    ).toContain("cancelled");
    expect(
      assistantMessage("en", {
        ...event,
        params: { ...event.params, status: "cancelled" },
      }),
    ).not.toContain("in 9 minutes");
  });
});
