import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { NotificationsFeedDto } from "@/application/notifications/use-cases";
import { notificationsMessages } from "@/ui/i18n/dictionaries/notifications";
import { LanguageProvider } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import {
  notificationActionCode,
  notificationActionLabel,
} from "@/ui/notifications/action-label";
import {
  notificationErrorCode,
  notificationErrorMessage,
} from "@/ui/notifications/error-message";
import { NotificationsView } from "@/ui/notifications/notifications-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const feed: NotificationsFeedDto = {
  high: [
    {
      id: "notification",
      kind: "change",
      priority: "high",
      title: "Пара перенесена",
      body: "Вымышленный текст из БД.",
      link: "/schedule",
      createdAt: "2026-11-04T22:30:00Z",
      readAt: null,
    },
  ],
  normal: [],
  digest: [],
  announcements: [
    {
      id: "announcement",
      title: "Объявление деканата",
      body: "Русский текст положения.",
      publishedAt: "2026-11-04T22:30:00Z",
    },
  ],
};

function render(language: "ru" | "en", data = feed) {
  const props = {
    language,
    children: createElement(NotificationsView, {
      feed: data,
      read: vi.fn(),
      readAll: vi.fn(),
    }),
  };
  return renderToStaticMarkup(createElement(LanguageProvider, props));
}

it("английская лента сохраняет БД-тексты и помечает их язык, дата остаётся московской", () => {
  const before = structuredClone(feed);
  const html = render("en");
  expect(html).toContain("Needs attention");
  expect(html).toContain("Notification categories");
  expect(html).toContain("Mark all as read");
  expect(html).toContain("Notification content is available in Russian.");
  expect(html).toContain("Announcement content is available in Russian.");
  expect(html).toContain('lang="ru">Пара перенесена');
  expect(html).toContain("Вымышленный текст из БД.");
  expect(html).toContain("5 November");
  expect(html).toContain("01:30");
  expect(html).toContain("Moscow time");
  expect(feed).toEqual(before);
});

it("русская лента сохраняет прежние подписи без английской пометки", () => {
  const html = render("ru");
  expect(html).toContain("Всегда в курсе");
  expect(html).toContain("Прочитать все");
  expect(html).toContain("Открыть расписание");
  expect(html).not.toContain("available in Russian");
  expect(html).not.toContain("Текст уведомления на русском языке.");
});

it("пустая лента предлагает английское действие", () => {
  const html = render("en", {
    high: [],
    normal: [],
    digest: [],
    announcements: [],
  });
  expect(html).toContain("No notifications yet");
  expect(html).toContain("View schedule");
});

it.each([
  ["/schedule?view=week", "openSchedule", "Open schedule"],
  ["/grades/id#work", "openGrades", "Open grades"],
  ["/requests/id", "openRequest", "Open request"],
  ["/requests", "open", "Open"],
] as const)(
  "действие %s определяется кодом назначения",
  (link, code, english) => {
    expect(notificationActionCode(link)).toBe(code);
    expect(notificationActionLabel(link, "en")).toBe(english);
    expect(notificationActionLabel(link)).toBe(
      t("ru", notificationsMessages, code),
    );
  },
);

it("ошибки переводятся по кодам, а неизвестный код даёт безопасное сообщение", () => {
  expect(
    notificationErrorCode({
      code: "VALIDATION",
      fieldErrors: { link: ["notificationLinkUnavailable"] },
    }),
  ).toBe("notificationLinkUnavailable");
  expect(
    notificationErrorMessage("en", {
      code: "VALIDATION",
      fieldErrors: { link: ["notificationLinkUnavailable"] },
    }),
  ).toBe("This link is unavailable. Please open the section from the menu.");
  expect(notificationErrorCode({ code: "VALIDATION" })).toBe(
    "notificationInvalid",
  );
  expect(notificationErrorMessage("en", { code: "UNKNOWN" })).toBe(
    "We couldn't complete this action. Please try again.",
  );
  for (const code of ["FORBIDDEN", "NOT_FOUND", "RATE_LIMITED", "CONFLICT"]) {
    expect(notificationErrorMessage("en", { code })).not.toMatch(/[А-Яа-яЁё]/);
  }
});
