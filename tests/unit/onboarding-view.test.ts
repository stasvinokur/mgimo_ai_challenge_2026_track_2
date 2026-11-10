import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import {
  GetMyOnboarding,
  type OnboardingDto,
} from "@/application/onboarding/get-onboarding";
import type { OnboardingRepository } from "@/application/onboarding/ports";
import type { Actor } from "@/application/ports/actor";
import { LanguageProvider } from "@/ui/i18n/language-provider";
import { PasskeyCard } from "@/ui/identity/passkey-card";
import { PushCard } from "@/ui/notifications/push-card";
import { OnboardingCard } from "@/ui/onboarding/onboarding-card";
import { TodayView } from "@/ui/today/today-view";
import { todayFixture } from "../fakes/today";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/profile",
}));

const destinations = {
  schedule: "/schedule?view=week",
  calendar: "/schedule",
  install: "/today/install",
  regulations: "/regulations?q=стипендия",
  assistant: "/profile/assistant",
  push: "/profile#push-notifications",
  passkey: "/profile#passkeys",
};

function stepLinks(html: string) {
  return Object.fromEntries(
    [
      ...html.matchAll(
        /data-onboarding-step="([^"]+)"[\s\S]*?<a [^>]*href="([^"]+)"/g,
      ),
    ].map((match) => [match[1], match[2]]),
  );
}

const onboarding: OnboardingDto = {
  steps: [
    { code: "schedule", automatic: false, completed: true },
    { code: "calendar", automatic: true, completed: false },
    { code: "install", automatic: false, completed: false },
    { code: "regulations", automatic: false, completed: false },
    { code: "assistant", automatic: true, completed: false },
  ],
  completed: 1,
  total: 5,
};

it("карточка содержит ссылки, явный прогресс и ручные кнопки только нужных шагов", () => {
  const html = renderToStaticMarkup(
    createElement(OnboardingCard, { initial: onboarding }),
  );
  for (const href of [
    "/schedule?view=week",
    "/schedule",
    "/today/install",
    "/regulations?q=стипендия",
    "/profile/assistant",
  ])
    expect(html).toContain(`href="${href}"`);
  expect(html).toContain("1 из 5");
  expect(html.match(/>Готово</g)).toHaveLength(2);
  expect(html.match(/Отметится автоматически/g)).toHaveLength(2);
  expect(html).toContain("Выполнено");
  expect(html).not.toContain('data-testid="today-action"');
  expect(html).not.toContain('aria-label="Готово');
});

it.each([
  { push: false, passkey: false, total: 5, extra: [] },
  { push: true, passkey: false, total: 6, extra: ["push"] },
  { push: false, passkey: true, total: 6, extra: ["passkey"] },
  { push: true, passkey: true, total: 7, extra: ["push", "passkey"] },
])(
  "флаги push=$push и passkey=$passkey меняют шаги существующей карточки",
  async ({ push, passkey, total, extra }) => {
    const actor: Actor = {
      kind: "student",
      userId: "onboarding-user",
      studentId: "onboarding-student",
      facultyId: "onboarding-faculty",
    };
    const repository: OnboardingRepository = {
      async findForUser(userId) {
        if (userId !== actor.userId) return null;
        return {
          course: 1,
          completedCodes: ["schedule"],
          automatic: {
            calendar: false,
            assistant: false,
            push: false,
            passkey: false,
          },
        };
      },
      completeForUser: vi.fn(),
    };
    const dto = await new GetMyOnboarding(
      repository,
      { now: () => new Date("2026-11-05T12:00:00.000Z") },
      { push, passkey },
    ).execute(actor);
    if (!dto) throw new Error("У первокурсника должна быть карточка.");
    const html = renderToStaticMarkup(
      createElement(OnboardingCard, { initial: dto }),
    );
    expect(
      [...html.matchAll(/data-onboarding-step="([^"]+)"/g)].map(
        (match) => match[1],
      ),
    ).toEqual([
      "schedule",
      "calendar",
      "install",
      "regulations",
      "assistant",
      ...extra,
    ]);
    expect(dto.total).toBe(total);
    expect(html).toContain(`1 из ${total}`);
    expect(stepLinks(html)).toEqual(
      Object.fromEntries(
        dto.steps.map(({ code }) => [code, destinations[code]]),
      ),
    );
    expect(html.includes('href="/profile#push-notifications"')).toBe(push);
    expect(html.includes("Включить уведомления на телефон")).toBe(push);
    expect(html.includes('href="/profile#passkeys"')).toBe(passkey);
    expect(html.includes("Добавить ключ доступа")).toBe(passkey);
    const englishProps = {
      language: "en" as const,
      children: createElement(OnboardingCard, { initial: dto }),
    };
    const english = renderToStaticMarkup(
      createElement(LanguageProvider, englishProps),
    );
    expect(stepLinks(english)).toEqual(stepLinks(html));
    for (const title of [
      "First steps",
      "View your weekly timetable",
      "Subscribe to your timetable calendar",
      "Install Pulse on your phone",
      "Find the scholarship regulations",
      "Ask the assistant a question",
      "Completes automatically",
      "Completed",
      `1 of ${total}`,
    ])
      expect(english).toContain(title);
    expect(english.includes("Enable phone notifications")).toBe(push);
    expect(english.includes("Add a passkey")).toBe(passkey);
    expect(english).toContain('data-onboarding-ready="false"');
    expect(english).not.toContain('aria-label="Done');
    expect(english).not.toContain("Первые шаги");
    expect(english).not.toContain("Отметится автоматически");
    expect(english).toContain('href="/regulations?q=стипендия"');
  },
);

it.each([
  { component: PushCard, anchor: "push-notifications" },
  { component: PasskeyCard, anchor: "passkeys" },
])(
  "карточка $anchor доступна по якорю с отступом от шапки",
  ({ component, anchor }) => {
    const html = renderToStaticMarkup(createElement(component));
    expect(html.match(new RegExp(`id="${anchor}"`, "g"))).toHaveLength(1);
    const target = html.match(new RegExp(`<[^>]+id="${anchor}"[^>]*>`))?.[0];
    expect(target).toMatch(/class="[^"]*\bscroll-mt-24\b/);
    expect(target).toContain('data-profile-anchor-ready="false"');
  },
);

it("завершённая карточка показывает английский итог и прогресс без ручных кнопок", () => {
  const complete: OnboardingDto = {
    ...onboarding,
    steps: onboarding.steps.map((step) => ({ ...step, completed: true })),
    completed: onboarding.total,
  };
  const englishProps = {
    language: "en" as const,
    children: createElement(OnboardingCard, { initial: complete }),
  };
  const html = renderToStaticMarkup(
    createElement(LanguageProvider, englishProps),
  );
  expect(html).toContain("5 of 5");
  expect(html).toContain("All set! You can hide this card.");
  expect(html.match(/>Completed</g)).toHaveLength(5);
  expect(html).not.toContain(">Done<");
  expect(html).not.toContain("Completes automatically");
  expect(html).toContain(">Hide<span");
  expect(html).toContain('class="sr-only"> first steps</span>');
});

it.each([1, 2, 3])(
  "карточка на Сегодня зависит от курса %s",
  async (course) => {
    const d = todayFixture();
    const html = renderToStaticMarkup(
      createElement(TodayView, {
        data: await d.overview.execute(d.timur),
        profile: {
          ok: true,
          data: {
            fullName: "Тимур Ветров",
            faculty: "Факультет",
            program: "Программа",
            course,
            group: "ТЕСТ-1",
            recordBookNo: "DEMO",
            scholarship: "none",
          },
        },
        onboarding: { ok: true, data: onboarding },
      }),
    );
    expect(html.includes('data-testid="onboarding-card"')).toBe(course === 1);
    expect(html).toContain("Основы маркетинга — есть долг");
    expect(html).toContain('data-testid="today-briefing"');
  },
);

it("ошибка онбординга не скрывает расписание и долг; предлагает повтор", async () => {
  const d = todayFixture();
  const html = renderToStaticMarkup(
    createElement(TodayView, {
      data: await d.overview.execute(d.timur),
      profile: {
        ok: true,
        data: {
          fullName: "Тимур Ветров",
          faculty: "Факультет",
          program: "Программа",
          course: 1,
          group: "ТЕСТ-1",
          recordBookNo: "DEMO",
          scholarship: "none",
        },
      },
      onboarding: { ok: false },
    }),
  );
  expect(html).toContain("Первые шаги: не удалось загрузить");
  expect(html).toContain("Повторить");
  expect(html).toContain("Основы маркетинга — есть долг");
});
