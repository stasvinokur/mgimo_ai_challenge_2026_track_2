import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { AssistantChatPanel } from "@/ui/assistant/chat";
import type { AssistantChat } from "@/ui/assistant/use-assistant";
import { LanguageProvider } from "@/ui/i18n/language-provider";

vi.mock("next/navigation", () => ({
  usePathname: () => "/profile/assistant",
  useRouter: () => ({ refresh: vi.fn() }),
}));

it.each([
  { language: "ru" as const, label: "Задать вопрос" },
  { language: "en" as const, label: "Ask question" },
])(
  "после готового ответа пустая форма $language не разрешает новый вопрос",
  ({ language, label }) => {
    const chat: AssistantChat = {
      id: "test-chat",
      messages: [
        {
          id: "answer",
          role: "assistant",
          parts: [{ type: "text", text: "Ответ готов." }],
        },
      ],
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
    const props = {
      language,
      children: createElement(AssistantChatPanel, { chat, close: vi.fn() }),
    };
    const html = renderToStaticMarkup(createElement(LanguageProvider, props));
    const submit = [...html.matchAll(/<button\b[^>]*>/g)]
      .map((match) => match[0])
      .find((tag) => tag.includes(`aria-label="${label}"`));
    expect(html).toContain("Ответ готов.");
    expect(html).toMatch(
      /<textarea\b[^>]*id="assistant-question"[^>]*><\/textarea>/,
    );
    expect(submit).toContain('disabled=""');
  },
);
