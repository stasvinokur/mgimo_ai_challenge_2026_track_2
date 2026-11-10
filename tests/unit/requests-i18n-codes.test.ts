import { expect, it } from "vitest";
import {
  getPickupMessage,
  getRequestExplanationMessage,
} from "@/application/requests/messages";
import { checkRequestPayload } from "@/application/requests/schemas";
import {
  eventDateErrors,
  eventDateMessages,
} from "@/domain/requests/event-release";
import { requestStatuses } from "@/domain/requests/request-flow";
import { enrollmentType } from "../fakes/requests";
import { eventPayload, eventType } from "../fakes/requests-event";

const now = new Date("2026-11-05T09:00:00.000Z");

it("каждый этап и вид заявки возвращает код пояснения без готового текста", () => {
  for (const type of [
    { code: "enrollment", isCertificate: true },
    { code: "event_release", isCertificate: false },
    { code: "question", isCertificate: false },
    { code: "unknown", isCertificate: false },
  ])
    for (const status of requestStatuses) {
      const message = getRequestExplanationMessage(status, type);
      expect(message).toEqual({
        code: expect.stringMatching(/^explanation[A-Z]/),
      });
      expect(JSON.stringify(message)).not.toMatch(/[А-Яа-яЁё]/);
    }
  expect(getRequestExplanationMessage("ready", eventType)).toEqual({
    code: "explanationEventReady",
  });
  expect(
    getRequestExplanationMessage("ready", {
      code: "question",
      isCertificate: false,
    }),
  ).toEqual({ code: "explanationAppealReady" });
});

it("состояния очереди передают закрытый код и неизменённый номер талона", () => {
  expect(getPickupMessage({ status: "booked", ticketNo: "А-003" })).toEqual({
    code: "pickupBooked",
    params: { ticketNo: "А-003" },
  });
  expect(getPickupMessage({ status: "called", ticketNo: "А-003" })).toEqual({
    code: "pickupCalled",
    params: { ticketNo: "А-003" },
  });
});

it.each([
  [{}, "requestRequired"],
  [{ destination: "   " }, "requestRequired"],
  [{ destination: 42 }, "requestRequired"],
  [{ destination: "x".repeat(501) }, "requestTooLong"],
])("проверка каталога возвращает код поля: %j", (payload, code) => {
  expect(
    checkRequestPayload(enrollmentType.fieldsSchema, payload),
  ).toMatchObject({
    success: false,
    fieldErrors: { destination: [code] },
  });
});

it.each([
  ["2026-11-02", "2026-11-01", "requestDateOrder", undefined],
  ["2026-11-05", "2026-11-19", "requestEventTooLong", 14],
  ["2026-10-21", "2026-10-21", "requestDateTooEarly", 14],
  ["2027-01-05", "2027-01-05", "requestDateTooLate", 60],
] as const)(
  "код периода содержит прежние границы: %s — %s",
  (from, to, code, days) => {
    const messages = eventDateMessages(from, to, "2026-11-05");
    expect(Object.values(messages ?? {}).flat()).toEqual([
      { code, ...(days === undefined ? {} : { params: { days } }) },
    ]);
    expect(
      checkRequestPayload(
        eventType.fieldsSchema,
        {
          ...eventPayload,
          dateFrom: from,
          dateTo: to,
        },
        false,
        now,
      ),
    ).toMatchObject({
      success: false,
      fieldErrors: expect.objectContaining({
        [code === "requestDateTooEarly" ? "dateFrom" : "dateTo"]: [code],
      }),
    });
  },
);

it("прежние русские потребители домена сохраняют представление периода", () => {
  expect(eventDateErrors("2026-11-05", "2026-11-19")).toEqual({
    dateTo: ["Не больше 14 дней включительно."],
  });
  expect(eventDateMessages("2026-11-05", "2026-11-18")).toBeNull();
  expect(eventDateMessages("2026-02-29", "2026-03-01")).toEqual({
    dateFrom: [{ code: "requestInvalidDates" }],
  });
  expect(eventDateMessages("2026-11-05", "2026-11-05", "invalid")).toEqual({
    dateFrom: [{ code: "requestPeriodUnavailable" }],
  });
});

it.each([
  ["eventName", "\u0000", "requestEventNameControl"],
  ["eventName", "\u200b", "requestEventNameRequired"],
  ["dateFrom", "2026-02-29", "requestInvalidDate"],
] as const)("специальная проверка %s отдаёт код %s", (field, value, code) => {
  const result = checkRequestPayload(
    eventType.fieldsSchema,
    {
      ...eventPayload,
      [field]: value,
    },
    false,
    now,
  );
  expect(result.success).toBe(false);
  if (!result.success) expect(result.fieldErrors[field]).toContain(code);
});
