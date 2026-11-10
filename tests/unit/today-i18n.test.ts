import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { TodayAction } from "@/application/today/get-today";
import { todayMessages } from "@/ui/i18n/dictionaries/today";
import { LanguageProvider } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { actionPresentation, todayActionLabel } from "@/ui/today/action-label";
import {
  localizedCountdown,
  requestStatus,
  scholarshipHeadline,
  todayDate,
  todayTime,
} from "@/ui/today/format";
import { TodayView } from "@/ui/today/today-view";
import { todayFixture } from "../fakes/today";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

it("в словаре today все переводы непустые и имеют одинаковые параметры", () => {
  for (const message of Object.values(todayMessages)) {
    expect(message.ru.trim()).not.toBe("");
    expect(message.en.trim()).not.toBe("");
    const params = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    expect(params(message.en)).toEqual(params(message.ru));
  }
  expect(t("en", todayMessages, "room", { room: "ДЕМО-А123" })).toBe(
    "Room ДЕМО-А123",
  );
});

it.each(["anna", "timur"] as const)(
  "DTO %s содержит коды, а UI сохраняет русский прогноз и переводит английский",
  async (account) => {
    const d = todayFixture();
    const data = await d.overview.execute(d[account]);
    const forecast = await d.sources.grades(d[account]);
    if (!data.study.ok) throw new Error("Нужен прогноз.");
    expect(scholarshipHeadline(data.study.data.scholarship)).toBe(
      forecast.scholarship.outlook.headline,
    );
    const scholarship = JSON.stringify(data.study.data.scholarship);
    expect(scholarship).not.toContain("headline");
    expect(scholarship).not.toContain('"label"');
    for (const action of data.actions) {
      expect(action).not.toHaveProperty("title");
      expect(action).not.toHaveProperty("description");
      expect(action.message.code).toMatch(
        /^(course|work|request|notification)$/,
      );
      const copy = actionPresentation(action, "en");
      expect(copy.title).not.toBe("");
      expect(copy.description).not.toBe("");
    }
    const providerProps = {
      language: "en" as const,
      children: createElement(TodayView, { data, language: "en" }),
    };
    const en = renderToStaticMarkup(
      createElement(LanguageProvider, providerProps),
    );
    for (const text of [
      "Today",
      "Day pulse",
      "Needs action",
      "What&#x27;s next",
      "Open academic progress",
      "Open timetable",
      "My requests",
      "Ask or do",
    ])
      expect(en).toContain(text);
    expect(en).not.toContain(">Требует действия<");
    expect(en).not.toContain(">Пульс дня<");
    expect(en).not.toContain("предметов в норме");
    expect(en).toContain(
      account === "anna"
        ? "Иностранный язык — at risk"
        : "Основы маркетинга — overdue required work",
    );
    expect(en).toContain("What can I do?");
  },
);

it.each([
  ["2026-11-04T06:01:00Z", "In 1 min", "In 1 minute"],
  ["2026-11-04T06:25:00Z", "In 25 min", "In 25 minutes"],
  ["2026-11-04T07:00:00Z", "In 1 hr", "In 1 hour"],
  ["2026-11-04T07:02:00Z", "In 1 hr 2 min", "In 1 hour 2 minutes"],
  ["2026-11-04T08:00:00Z", "In 2 hr", "In 2 hours"],
  ["2026-11-05T06:00:00Z", "Tomorrow at 09:00", "Tomorrow at 09:00"],
  ["2026-11-06T06:00:00Z", "6 November at 09:00", "6 November at 09:00"],
])(
  "английский отсчёт %s использует коды и московское время",
  (start, visual, spoken) => {
    expect(localizedCountdown(start, "2026-11-04T06:00:00Z", "en")).toBe(
      visual,
    );
    expect(localizedCountdown(start, "2026-11-04T06:00:00Z", "en", true)).toBe(
      spoken,
    );
  },
);

it("English форматирует календарную полночь Москвы независимо от UTC", () => {
  expect(todayDate("2026-11-04T22:30:00Z", false, "en")).toBe("5 November");
  expect(todayTime("2026-11-04T22:30:00Z", "en")).toBe("01:30");
});

it.each([
  ["draft", "Draft"],
  ["submitted", "Submitted"],
  ["accepted", "Accepted"],
  ["in_progress", "In progress"],
  ["needs_info", "More information needed"],
  ["ready", "Ready"],
  ["issued", "Issued"],
  ["rejected", "Rejected"],
  ["cancelled", "Cancelled"],
] as const)("код заявки %s имеет английское представление", (code, label) => {
  expect(requestStatus(code, "en")).toBe(label);
});

it("действие переведено по коду и пути без распознавания русского текста", () => {
  const messages: TodayAction["message"][] = [
    { code: "course", course: "ДЕМО: Курс", state: "plan", advice: "resit" },
    { code: "course", course: "ДЕМО: Курс", state: "risk", advice: "improve" },
    { code: "work", course: "ДЕМО: Курс", work: "ДЕМО: Работа", overdue: true },
    {
      code: "work",
      course: "ДЕМО: Курс",
      work: "ДЕМО: Работа",
      overdue: false,
    },
    { code: "request", title: "ДЕМО: Документ", status: "needs_info" },
    { code: "notification", title: "ДЕМО: Новость", body: "Данные БД" },
  ];
  for (const message of messages)
    expect(actionPresentation({ message }, "en").title).toContain("ДЕМО:");
  const notice = messages[5];
  if (!notice) throw new Error("Нужно уведомление.");
  expect(actionPresentation({ message: notice }, "en")).toEqual({
    title: "ДЕМО: Новость",
    description: "Данные БД",
  });
  for (const [href, expected] of [
    ["/schedule?view=week", "View changes"],
    ["/grades/course", "Check assignments"],
    ["/requests/own", "Open request"],
    ["/notifications", "Open notifications"],
    ["/schedule-other", "Open"],
  ] as const)
    expect(
      todayActionLabel(
        { section: "notifications", href, label: "openNotifications" },
        "en",
      ),
    ).toBe(expected);
});
