import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  getRequestKind,
  type RequestKind,
  type RequestStatus,
  requestDto,
  requestLabels,
} from "@/application/requests/dto";
import type { RequestDetailDto } from "@/application/requests/queries";
import {
  getRequestExplanation,
  RequestTimeline,
} from "@/ui/requests/request-timeline";
import { requestFixtures } from "../../scripts/fixtures/requests";
import { fixtureContext } from "../../scripts/fixtures/shared";
import { FakeClock } from "../fakes/clock";
import { SequentialIdGenerator } from "../fakes/id-generator";
import { enrollmentType } from "../fakes/requests";

function request(
  stages: RequestStatus[],
  type = enrollmentType,
): RequestDetailDto {
  const at = "2026-11-04T22:30:00.000Z";
  return {
    ...requestDto(
      {
        id: "request",
        publicNo: "З-2026-000001",
        studentId: "student",
        facultyId: "fmo",
        studentUserId: "user",
        typeCode: type.code,
        payload: {},
        status: stages.at(-1) ?? "draft",
        assignee: null,
        submittedAt: at,
        dueAt: "2026-11-09T09:00:00.000Z",
        createdAt: at,
        updatedAt: at,
      },
      type,
      new Date(at),
    ),
    events: stages.map((toStatus, index) => ({
      id: `event-${index}`,
      fromStatus: stages[index - 1] ?? null,
      toStatus,
      at,
      comment: toStatus === "needs_info" ? "Уточните адресата" : null,
    })),
  };
}

it.each([
  ["submitted"],
  ["submitted", "accepted", "in_progress"],
  ["submitted", "accepted", "in_progress", "needs_info"],
  ["submitted", "accepted", "in_progress", "needs_info", "in_progress"],
  ["submitted", "accepted", "in_progress", "ready"],
  ["submitted", "accepted", "in_progress", "ready", "issued"],
  ["submitted", "rejected"],
  ["submitted", "cancelled"],
] satisfies RequestStatus[][])(
  "последнее событие — единственный текущий этап: %j",
  (...stages) => {
    const data = request(stages);
    const html = renderToStaticMarkup(
      createElement(RequestTimeline, { request: data }),
    );
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    const current = html.match(
      /<li[^>]*aria-current="step"[\s\S]*?<\/li>/,
    )?.[0];
    expect(current).toContain(`${requestLabels[data.status]} · текущий этап`);
    expect(html).toContain("5 ноября 2026 г. в 01:30");
    expect(html).not.toContain("Марина");
    if (["issued", "rejected", "cancelled"].includes(data.status))
      expect(html).not.toContain("ожидается");
    if (data.status === "needs_info")
      expect(current).toContain("Уточните адресата");
    if (data.status === "ready") expect(html).toContain("Выдана · ожидается");
  },
);

const catalog = requestFixtures(
  fixtureContext(
    new FakeClock("2026-11-05T09:00:00Z"),
    new SequentialIdGenerator(),
  ),
).requestTypes;

const expectedExplanations: Record<
  RequestKind,
  Record<"accepted" | "in_progress" | "ready" | "issued", string>
> = {
  certificate: {
    accepted:
      "Данные проверены. Сотрудник скоро начнёт готовить ответ или справку.",
    in_progress:
      "Сотрудник готовит результат. Дополнительных действий от вас сейчас не требуется.",
    ready:
      "Результат готов. Электронная справка доступна в кабинете, бумажный документ — в деканате.",
    issued: "Результат выдан. История обращения останется в вашем кабинете.",
  },
  event_release: {
    accepted:
      "Данные проверены. Сотрудник скоро рассмотрит освобождение на время мероприятия.",
    in_progress:
      "Сотрудник рассматривает освобождение и проверяет пары на время мероприятия. Дополнительных действий от вас сейчас не требуется.",
    ready:
      "Освобождение одобрено. Пары на время мероприятия отмечены как уважительные.",
    issued:
      "Заявка завершена. Пары на время мероприятия отмечены как уважительные. История обращения останется в вашем кабинете.",
  },
  appeal: {
    accepted: "Данные проверены. Сотрудник скоро рассмотрит заявку.",
    in_progress:
      "Сотрудник рассматривает заявку. Решение или ответ появится в его комментарии.",
    ready:
      "Рассмотрение завершено. Решение или ответ — в комментарии сотрудника.",
    issued:
      "Заявка завершена. Решение или ответ — в комментарии сотрудника. История обращения останется в вашем кабинете.",
  },
};

it.each([
  ["enrollment", "certificate"],
  ["enrollment_paper", "certificate"],
  ["military", "certificate"],
  ["visa", "certificate"],
  ["scholarship", "certificate"],
  ["event_release", "event_release"],
  ["retake", "appeal"],
  ["academic_leave", "appeal"],
  ["question", "appeal"],
] satisfies [string, RequestKind][])(
  "%s: пояснения этапов соответствуют виду %s из каталога",
  (code, kind) => {
    const type = catalog.find((type) => type.code === code);
    if (!type) throw new Error(`Тип ${code} отсутствует в каталоге`);
    expect(getRequestKind(type)).toBe(kind);
    for (const status of [
      "accepted",
      "in_progress",
      "ready",
      "issued",
    ] as const) {
      const data = request(["submitted", status], type);
      const explanation = getRequestExplanation(status, data.type);
      expect(explanation).toBe(expectedExplanations[kind][status]);
      const html = renderToStaticMarkup(
        createElement(RequestTimeline, { request: data }),
      );
      const current = html.match(
        /<li[^>]*aria-current="step"[\s\S]*?<\/li>/,
      )?.[0];
      if (status === "ready" || status === "issued") {
        expect(current).toContain(explanation);
      } else {
        expect(current).not.toContain(explanation);
      }
      if (kind !== "certificate") {
        expect(html).not.toMatch(/справк|бумажн|PDF/i);
      }
    }
  },
);

it("вид не зависит от названия, способа получения или списка полей", () => {
  const event = catalog.find((type) => type.code === "event_release");
  if (!event) throw new Error("Нужен тип освобождения");
  const renamedEvent = { ...event, title: "Справка об обучении" };
  const renamedCertificate = {
    ...enrollmentType,
    code: "another_certificate",
    title: "Освобождение на время мероприятия",
  };
  expect(getRequestExplanation("ready", renamedEvent)).toBe(
    expectedExplanations.event_release.ready,
  );
  expect(getRequestExplanation("ready", renamedCertificate)).toBe(
    expectedExplanations.certificate.ready,
  );
  expect(
    getRequestExplanation("ready", {
      ...enrollmentType,
      code: "another_appeal",
      isCertificate: false,
    }),
  ).toBe(expectedExplanations.appeal.ready);
});

it.each([
  "draft",
  "submitted",
  "needs_info",
  "rejected",
  "cancelled",
] satisfies RequestStatus[])(
  "%s: общие подсказки сохранены для всех видов",
  (status) => {
    const expected = getRequestExplanation(status, enrollmentType);
    expect(expected.length).toBeGreaterThan(0);
    for (const type of catalog) {
      expect(getRequestExplanation(status, type)).toBe(expected);
    }
  },
);
