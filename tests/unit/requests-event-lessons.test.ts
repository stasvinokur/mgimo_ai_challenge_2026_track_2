import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { EventReleaseBasis } from "@/application/requests/event-release-basis";
import type { StaffDetailDto } from "@/application/staff/queries";
import { EventLessonList } from "@/ui/requests/event-lessons";
import { StaffRequestDetail } from "@/ui/staff/detail";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const basis: EventReleaseBasis = {
  section: "4",
  title: "Участие в мероприятиях и освобождение",
};
const explanation =
  "Основание: пункт 4 «Участие в мероприятиях и освобождение» положения о посещаемости";
const props = { typeCode: "event_release", payload: { eventLessons: [] } };

it("сотруднику показано основание текстом без ссылки на студенческое положение", () => {
  const html = renderToStaticMarkup(
    createElement(EventLessonList, { ...props, audience: "staff", basis }),
  );
  expect(html).toContain(explanation);
  expect(html).not.toContain('href="/regulations/');
  expect(html).not.toContain("Почему?");
});

it("название пункта для сотрудника не подменяется текстом из компонента", () => {
  const html = renderToStaticMarkup(
    createElement(EventLessonList, {
      ...props,
      audience: "staff",
      basis: { ...basis, title: "Обновлённое название из положения" },
    }),
  );
  expect(html).toContain("пункт 4 «Обновлённое название из положения»");
  expect(html).not.toContain(basis.title);
});

it("студенту остаётся ссылка «Почему?» на прежний пункт положения", () => {
  const html = renderToStaticMarkup(
    createElement(EventLessonList, { ...props, audience: "student" }),
  );
  expect(html).toMatch(
    /<a[^>]+href="\/regulations\/attendance#p-4"[^>]*>Почему\?<\/a>/,
  );
  expect(html).not.toContain("Основание: пункт");
});

it("другие типы заявок не получают список пар и основание освобождения", () => {
  expect(
    renderToStaticMarkup(
      createElement(EventLessonList, {
        ...props,
        typeCode: "enrollment",
        audience: "staff",
        basis: null,
      }),
    ),
  ).toBe("");
});

function request(isCertificate: boolean): StaffDetailDto {
  return {
    demoCommentsOnly: false,
    id: "request",
    publicNo: "З-2026-000123",
    type: {
      code: isCertificate ? "enrollment" : "event_release",
      title: isCertificate ? "Справка об обучении" : "Освобождение от занятий",
      description: "Вымышленная заявка",
      slaWorkDays: 3,
      delivery: isCertificate ? "pdf" : "pickup",
      isCertificate,
      fields: [],
    },
    payload: { eventLessons: [] },
    status: "ready",
    assignee: null,
    submittedAt: "2026-11-05T09:00:00Z",
    dueAt: "2026-11-10T09:00:00Z",
    createdAt: "2026-11-05T09:00:00Z",
    updatedAt: "2026-11-05T09:00:00Z",
    sla: null,
    student: { fullName: "Учебный студент", group: "ДЕМО-1", faculty: "ФМО" },
    actions: ["issued"],
    events: [],
    audit: [],
  };
}

it.each([false, true])(
  "карточка сотрудника (справка: %s) содержит только доступную ссылку в очередь",
  (isCertificate) => {
    const html = renderToStaticMarkup(
      createElement(StaffRequestDetail, {
        request: request(isCertificate),
        eventReleaseBasis: isCertificate ? null : basis,
        change: async () => ({ ok: true as const }),
      }),
    );
    expect(
      [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]),
    ).toEqual(["/staff/requests"]);
    expect(html).not.toContain("Скачать справку");
    expect(html).not.toContain("Почему?");
    if (!isCertificate) expect(html).toContain(explanation);
  },
);
