import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { DraftCard } from "@/application/assistant/ports";
import { AssistantChatPanel } from "@/ui/assistant/chat";
import type { AssistantMessage } from "@/ui/assistant/message";
import type { AssistantChat } from "@/ui/assistant/use-assistant";
import type { Language } from "@/ui/i18n/language";
import { LanguageProvider } from "@/ui/i18n/language-provider";

vi.mock("next/navigation", () => ({
  usePathname: () => "/today",
  useRouter: () => ({ refresh: vi.fn() }),
}));

const first: DraftCard = {
  id: "draft-1",
  approvalId: "approval-1",
  typeCode: "enrollment",
  title: "Справка об обучении",
  fields: [],
  slaWorkDays: 3,
  expectedAt: "2026-11-09T09:00:00Z",
  delivery: "pdf",
  href: "/requests/draft-1",
  source: {
    href: "/regulations/certificates#p-3-2",
    documentTitle: "Справки",
    section: "3.2",
    excerpt: "Текст положения",
  },
  canSubmit: true,
};
const revised = { ...first, approvalId: "approval-2" };

function dialog(drafts: DraftCard[], language: Language, oneMessage: boolean) {
  const parts = drafts.map((draft, index) => ({
    type: "data-assistant" as const,
    id: `part-${index}`,
    data: { type: "draft" as const, draft },
  }));
  const messages: AssistantMessage[] = oneMessage
    ? [{ id: "message", role: "assistant", parts }]
    : parts.map((part, index) => ({
        id: `message-${index}`,
        role: "assistant",
        parts: [part],
      }));
  const chat: AssistantChat = {
    id: "chat",
    messages,
    status: "ready",
    error: undefined,
    setMessages: vi.fn(),
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
  return renderToStaticMarkup(createElement(LanguageProvider, props));
}

function attribute(attributes: string, name: string) {
  return new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attributes)?.[1];
}

function textContent(markup: string) {
  return markup
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();
}

const cases = [
  {
    name: "разные типы",
    drafts: [
      first,
      {
        ...revised,
        id: "draft-2",
        typeCode: "question",
        title: "Вопрос в деканат",
      },
    ],
    titles: {
      ru: ["Справка об обучении", "Вопрос в деканат"],
      en: ["Enrolment certificate", "Question for the dean’s office"],
    },
    oneMessage: false,
  },
  {
    name: "два черновика одного типа",
    drafts: [first, { ...revised, id: "draft-2" }],
    titles: {
      ru: ["Справка об обучении", "Справка об обучении"],
      en: ["Enrolment certificate", "Enrolment certificate"],
    },
    oneMessage: false,
  },
  {
    name: "две версии одного id",
    drafts: [first, revised],
    titles: {
      ru: ["Справка об обучении", "Справка об обучении"],
      en: ["Enrolment certificate", "Enrolment certificate"],
    },
    oneMessage: false,
  },
  {
    name: "две карточки в одном ответе",
    drafts: [first, revised],
    titles: {
      ru: ["Справка об обучении", "Справка об обучении"],
      en: ["Enrolment certificate", "Enrolment certificate"],
    },
    oneMessage: true,
  },
];

for (const language of ["ru", "en"] as const) {
  it.each(cases)(
    `области ${language}: $name имеют уникальные полные имена`,
    ({ drafts, titles, oneMessage }) => {
      const html = dialog(drafts, language, oneMessage);
      const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(
        (match) => match[1],
      );
      expect(new Set(ids).size).toBe(ids.length);
      const nodes = new Map(
        [...html.matchAll(/<(span|h3)\b([^>]*)>([\s\S]*?)<\/\1>/g)].flatMap(
          (match) => {
            const id = attribute(match[2] ?? "", "id");
            return id
              ? [
                  [
                    id,
                    {
                      tag: match[1],
                      attributes: match[2] ?? "",
                      text: textContent(match[3] ?? ""),
                    },
                  ] as const,
                ]
              : [];
          },
        ),
      );
      const regions = [...html.matchAll(/<(div|section)\b([^>]*)>/g)]
        .filter(
          (match) =>
            attribute(match[2] ?? "", "data-assistant-draft") !== undefined ||
            match[1] === "section",
        )
        .map((match) => {
          const attributes = match[2] ?? "";
          const refs =
            attribute(attributes, "aria-labelledby")?.split(/\s+/) ?? [];
          expect(refs).toHaveLength(2);
          const prefix = nodes.get(refs[0] ?? "");
          const heading = nodes.get(refs[1] ?? "");
          expect(prefix?.tag).toBe("span");
          expect(
            attribute(prefix?.attributes ?? "", "class")?.split(/\s+/),
          ).toContain("sr-only");
          expect(heading?.tag).toBe("h3");
          expect(
            attribute(heading?.attributes ?? "", "aria-label"),
          ).toBeUndefined();
          expect(
            attribute(heading?.attributes ?? "", "aria-labelledby"),
          ).toBeUndefined();
          // Referenced sr-only text contributes to the accessible name.
          return {
            tag: match[1],
            attributes,
            name: `${prefix?.text} ${heading?.text}`,
            title: heading?.text,
            refs,
          };
        });
      expect(regions).toHaveLength(4);
      expect(new Set(regions.map((region) => region.name)).size).toBe(4);
      const cards = regions.filter((region) => region.tag === "div");
      const profiles = regions.filter((region) => region.tag === "section");
      expect(cards.map((card) => attribute(card.attributes, "role"))).toEqual([
        "region",
        "region",
      ]);
      expect(
        cards.map((card) => attribute(card.attributes, "data-assistant-draft")),
      ).toEqual(["1", "2"]);
      expect(cards.map((card) => card.title)).toEqual(titles[language]);
      expect(profiles.map((profile) => profile.title)).toEqual(
        titles[language],
      );
      expect(cards.map((card) => card.name)).toEqual(
        titles[language].map((title, index) =>
          language === "ru"
            ? `Черновик заявки № ${index + 1}: ${title}`
            : `Request draft ${index + 1}: ${title}`,
        ),
      );
      expect(profiles.map((profile) => profile.name)).toEqual(
        titles[language].map((title, index) =>
          language === "ru"
            ? `Данные из профиля для черновика № ${index + 1}: ${title}`
            : `Profile details for draft ${index + 1}: ${title}`,
        ),
      );
      for (const [index, profile] of profiles.entries()) {
        expect([undefined, "region"]).toContain(
          attribute(profile.attributes, "role"),
        );
        expect(profile.refs[1]).toBe(cards[index]?.refs[1]);
        expect(profile.name.toLowerCase()).not.toContain(
          language === "ru" ? "черновик заявки" : "request draft",
        );
      }
    },
  );
}
