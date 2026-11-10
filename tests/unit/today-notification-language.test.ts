import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { TodayAction, TodayDto } from "@/application/today/get-today";
import { notificationsMessages } from "@/ui/i18n/dictionaries/notifications";
import { LanguageProvider } from "@/ui/i18n/language-provider";
import { buildTodayBriefing } from "@/ui/today/briefing";
import { TodayView } from "@/ui/today/today-view";
import { todayFixture } from "../fakes/today";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const notice: TodayAction = {
  id: "notification:arbitrary",
  section: "notifications",
  message: {
    code: "notification",
    title: "График консультаций изменён",
    body: "ДЕМО: подробности уведомления из БД.",
  },
  href: "/notifications",
  label: "openNotifications",
  urgency: "today",
  dueAt: null,
};

async function dataWithNotice() {
  const d = todayFixture();
  const data = await d.overview.execute(d.anna);
  data.actions = [
    structuredClone(notice),
    {
      id: "request:ready",
      section: "requests",
      message: { code: "request", title: "ДЕМО: справка", status: "ready" },
      href: "/requests/ready",
      label: "getCertificate",
      urgency: "today",
      dueAt: null,
    },
  ];
  return data;
}

it("English помечает только уведомление БД в нужной карточке Needs action", async () => {
  const data = await dataWithNotice();
  const before = structuredClone(data);
  const props = {
    language: "en" as const,
    children: createElement(TodayView, { data, language: "en" }),
  };
  const html = renderToStaticMarkup(createElement(LanguageProvider, props));
  const rows = [
    ...html.matchAll(
      /<li\b[^>]*data-testid="today-action"[^>]*>[\s\S]*?<\/li>/g,
    ),
  ].map(([row]) => row);
  expect(rows).toHaveLength(2);
  const notification = rows.find((row) => row.includes("График консультаций"));
  expect(notification).toBeDefined();
  expect(notification).toContain(notificationsMessages.russianContent.en);
  expect(notification).toMatch(
    /<h3\b[^>]*lang="ru"[^>]*>График консультаций изменён<\/h3>/,
  );
  expect(notification).toMatch(
    /<p\b[^>]*lang="ru"[^>]*>ДЕМО: подробности уведомления из БД\.<\/p>/,
  );
  const request = rows.find((row) => row.includes("ДЕМО: справка"));
  expect(request).toBeDefined();
  expect(request).not.toContain(notificationsMessages.russianContent.en);
  expect(request).not.toContain('lang="ru"');
  expect(data).toEqual(before);
});

it("русская карточка сохраняет исходные заголовок, описание и действие без пометки", async () => {
  const data = await dataWithNotice();
  const html = renderToStaticMarkup(createElement(TodayView, { data }));
  const row = html.match(
    /<li\b[^>]*data-testid="today-action"[^>]*>[\s\S]*?<\/li>/,
  )?.[0];
  expect(row).toContain(
    '<h3 class="font-semibold leading-snug">График консультаций изменён</h3>',
  );
  expect(row).toContain(
    '<p class="text-sm text-muted-foreground">ДЕМО: подробности уведомления из БД.</p>',
  );
  expect(row).toContain("Открыть уведомления");
  expect(row).not.toContain(notificationsMessages.russianContent.en);
  expect(row).not.toContain(notificationsMessages.russianContent.ru);
  expect(row).not.toContain('lang="ru"');
});

it.each([
  "Пара перенесена",
  "Остался итоговый тест",
  "График консультаций изменён",
])(
  "English сводка выделяет исходный текст БД «%s» кавычками, русский вывод прежний",
  async (title) => {
    const data: TodayDto = {
      ...(await dataWithNotice()),
      schedule: { ok: false },
      study: { ok: false },
      requests: { ok: false },
      actions: [
        {
          ...notice,
          message: { code: "notification", title, body: "ДЕМО: текст из БД" },
        },
      ],
    };
    const before = structuredClone(data);
    expect(buildTodayBriefing(data, data.asOf, "en")).toEqual([
      `Priority: “${title}”.`,
    ]);
    expect(buildTodayBriefing(data, data.asOf, "ru")).toEqual([
      `Главное: ${title}.`,
    ]);
    expect(data).toEqual(before);
  },
);
