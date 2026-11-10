import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AssistantEvent, DraftCard } from "@/application/assistant/ports";
import { AssistantChatPanel, AssistantDraftCard } from "@/ui/assistant/chat";
import type { AssistantMessage } from "@/ui/assistant/message";
import type { AssistantChat } from "@/ui/assistant/use-assistant";
import { FakeStudentRepository } from "../fakes/identity";

vi.mock("next/navigation", () => ({
  usePathname: () => "/today",
  useRouter: () => ({ refresh: vi.fn() }),
}));

const first: DraftCard = {
  id: "draft-1",
  approvalId: "approval-1",
  title: "Справка об обучении",
  fields: [{ title: "Получатель", value: "Работодатель", required: true }],
  slaWorkDays: 3,
  expectedAt: "2026-11-09T09:00:00Z",
  delivery: "pdf",
  href: "/requests/draft-1",
  source: {
    href: "/regulations/certificates#p-3-2",
    documentTitle: "Справки",
    section: "3.2",
    excerpt: "Справка об обучении",
  },
  canSubmit: true,
};
const second: DraftCard = { ...first, approvalId: "approval-2" };
const declined: AssistantEvent = {
  type: "declined",
  id: first.id,
  approvalId: "approval-1",
};
const submitted: AssistantEvent = {
  type: "submitted",
  id: first.id,
  publicNo: "З-2026-000123",
};

function cards(events: Exclude<AssistantEvent, { type: "text" }>[]) {
  const messages: AssistantMessage[] = events.map((data, index) => ({
    id: String(index),
    role: "assistant",
    parts: [{ type: "data-assistant", data }],
  }));
  const chat: AssistantChat = {
    id: "test-chat",
    messages,
    setMessages: vi.fn(),
    status: "ready",
    error: undefined,
    sendMessage: vi.fn(async () => {}),
    regenerate: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    resumeStream: vi.fn(async () => {}),
    addToolResult: vi.fn(async () => {}),
    addToolOutput: vi.fn(async () => {}),
    addToolApprovalResponse: vi.fn(async () => {}),
    clearError: vi.fn(),
  };
  return renderToStaticMarkup(
    createElement(AssistantChatPanel, { chat, close: vi.fn() }),
  )
    .split(/(?=<div\b[^>]*\bdata-assistant-draft=")/)
    .slice(1);
}

function expectButtons(markup: string | undefined, visible: boolean) {
  expect(markup).toBeDefined();
  for (const label of ["Подтвердить отправку", "Не отправлять"]) {
    if (visible) expect(markup).toContain(label);
    else expect(markup).not.toContain(label);
  }
}

describe("Карточки ассистента: решение относится к подтверждению", () => {
  it("вычисленный список пар без признака обязательности, подписи полей ввода сохранены", () => {
    const html = renderToStaticMarkup(
      createElement(AssistantDraftCard, {
        draft: {
          ...first,
          fields: [
            { title: "Название мероприятия", value: "Хакатон", required: true },
            { title: "Комментарий", value: "", required: false },
          ],
          lessons: [
            {
              course: "История",
              startsAt: "2026-11-12T06:00:00Z",
              room: "204",
            },
          ],
        },
        profile: null,
        profileError: false,
        retryProfile: vi.fn(),
        sent: false,
        disabled: false,
        decided: false,
        onDecision: vi.fn(),
        close: vi.fn(),
      }),
    );
    const labels = Array.from(
      html.matchAll(/<dt[^>]*>(.*?)<\/dt>/g),
      (match) => match[1],
    );
    expect(labels).toContain("Пары на время мероприятия");
    expect(labels).toContain("Название мероприятия · обязательно");
    expect(labels).toContain("Комментарий · необязательно");
    expect(html).toContain("История · 12 ноября в 09:00 МСК · 204");
    expect(labels).not.toContain("Пары на время мероприятия · необязательно");
  });

  it("во время отправки первая кнопка остаётся неактивной и не заменяется ссылкой правки", () => {
    const profile = new FakeStudentRepository().profiles.get("anna-student");
    if (!profile) throw new Error("Нужен профиль");
    const html = renderToStaticMarkup(
      createElement(AssistantDraftCard, {
        draft: first,
        profile,
        profileError: false,
        retryProfile: vi.fn(),
        sent: false,
        decided: false,
        disabled: true,
        pendingDecision: "approve",
        onDecision: vi.fn(),
        close: vi.fn(),
      }),
    );
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*aria-busy="true"[^>]*>Отправляем…<\/button>/,
    );
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*>Не отправлять<\/button>/,
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Изменить<\/button>/);
    expect(html).not.toContain('href="/requests/draft-1"');
  });

  it("результат и единственная ссылка остаются в последней карточке того же черновика", () => {
    const html = cards([
      { type: "draft", draft: first },
      declined,
      { type: "draft", draft: second },
      submitted,
    ]);
    expect(html.join("")).toContain("Заявка З-2026-000123 отправлена");
    expect(html.join("").match(/Открыть заявку З-2026-000123/g)).toHaveLength(
      1,
    );
    for (const markup of html) {
      expectButtons(markup, false);
      expect(markup).not.toContain(">Изменить</");
    }
    expect(html[0]).not.toContain("Открыть заявку");
    expect(html[1]).toContain('href="/requests/draft-1"');
  });
  it("документ показывает все поля целиком, включая необязательные, и отдельно неизменяемый профиль", () => {
    const profile = new FakeStudentRepository().profiles.get("anna-student");
    if (!profile) throw new Error("Нужен вымышленный профиль");
    const longValue = "Полный адресат «Учебная организация»\n".repeat(20);
    const html = renderToStaticMarkup(
      createElement(AssistantDraftCard, {
        draft: {
          ...first,
          fields: [
            ...first.fields,
            { title: "Комментарий", required: false, value: longValue },
            { title: "Страна", required: false, value: "" },
          ],
        },
        profile,
        profileError: false,
        retryProfile: vi.fn(),
        sent: false,
        disabled: false,
        decided: false,
        onDecision: vi.fn(),
        close: vi.fn(),
      }),
    );
    expect(html).toContain(longValue);
    expect(html).toContain("Страна");
    expect(html).toContain("Не указано");
    expect(html).toContain("Черновик · не отправлен");
    expect(html).toContain("Без вашего нажатия заявка не уйдёт");
    for (const value of [
      profile.fullName,
      profile.faculty,
      profile.program,
      profile.group,
      profile.recordBookNo,
    ])
      expect(html).toContain(value);
    expect(html).toContain("Из профиля · подставлено автоматически");
  });

  it("без доступного профиля подтверждение заблокировано и есть повтор загрузки", () => {
    const html = renderToStaticMarkup(
      createElement(AssistantDraftCard, {
        draft: first,
        profile: null,
        profileError: true,
        retryProfile: vi.fn(),
        sent: false,
        disabled: false,
        decided: false,
        onDecision: vi.fn(),
        close: vi.fn(),
      }),
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Подтвердить отправку/);
    expect(html).toContain("Повторить загрузку профиля");
    expect(html).toContain('role="alert"');
  });
  it("отказ закрывает показанную версию", () => {
    const html = cards([{ type: "draft", draft: first }, declined])[0];
    expectButtons(html, false);
    expect(html).not.toContain(">Изменить</");
  });

  it("после отказа новая версия того же черновика получает кнопки", () => {
    const html = cards([
      { type: "draft", draft: first },
      declined,
      { type: "draft", draft: second },
    ]);
    expectButtons(html[0], false);
    expectButtons(html[1], true);
  });

  it("устаревшая карточка без решения неактивна", () => {
    const html = cards([
      { type: "draft", draft: first },
      { type: "draft", draft: second },
    ]);
    expectButtons(html[0], false);
    expectButtons(html[1], true);
  });

  it("отправка скрывает кнопки у всех версий, включая последующую карточку", () => {
    for (const later of [[], [{ type: "draft" as const, draft: second }]]) {
      const html = cards([
        { type: "draft", draft: first },
        declined,
        { type: "draft", draft: second },
        submitted,
        ...later,
      ]);
      for (const card of html) {
        expectButtons(card, false);
        expect(card).not.toContain(">Изменить</");
      }
    }
  });

  it("отправка другой заявки не закрывает новый черновик", () => {
    const html = cards([
      { type: "draft", draft: first },
      submitted,
      { type: "draft", draft: { ...second, id: "draft-2" } },
    ]);
    expectButtons(html[0], false);
    expectButtons(html[1], true);
  });

  it("последняя неполная карточка не активирует предыдущую", () => {
    const html = cards([
      { type: "draft", draft: first },
      {
        type: "draft",
        draft: { ...second, approvalId: undefined, canSubmit: false },
      },
    ]);
    for (const card of html) expectButtons(card, false);
  });
});
