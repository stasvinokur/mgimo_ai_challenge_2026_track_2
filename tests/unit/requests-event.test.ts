import { expect, it } from "vitest";
import {
  checkRequestPayload,
  parseEventPreview,
} from "@/application/requests/schemas";
import {
  EVENT_MAX_YEAR,
  EVENT_MIN_YEAR,
  eventDateErrors,
  eventLessons,
  validEventDate,
} from "@/domain/requests/event-release";
import { ValidationError } from "@/domain/shared/errors";
import { eventPayload, eventType } from "../fakes/requests-event";
import { change, scheduleData, slot } from "../fakes/schedule";

const now = new Date("2026-11-05T09:00:00.000Z");

it.each([
  ["2026-11-01", "2026-11-14", true],
  ["2026-11-01", "2026-11-15", false],
  ["2026-11-02", "2026-11-01", false],
  ["2026-11-02", "2026-11-02", true],
  ["2028-02-29", "2028-03-01", true],
  ["2026-02-29", "2026-03-01", false],
  ["2026-11-31", "2026-12-01", false],
  ["2026-1-1", "2026-01-02", false],
])("домен и zod одинаково проверяют %s–%s", (dateFrom, dateTo, valid) => {
  expect(eventDateErrors(dateFrom, dateTo) === null).toBe(valid);
  expect(
    checkRequestPayload(
      eventType.fieldsSchema,
      {
        ...eventPayload,
        dateFrom,
        dateTo,
      },
      false,
      dateFrom.startsWith("2028") ? new Date("2028-02-29T09:00:00.000Z") : now,
    ).success,
  ).toBe(valid);
  if (!valid)
    expect(() => eventLessons(scheduleData(), dateFrom, dateTo)).toThrow(
      ValidationError,
    );
});

it("перенос внутрь периода сохраняет исходный ключ; отмена и перенос наружу исключаются", () => {
  const data = scheduleData({
    slots: [slot, { ...slot, id: "cancelled" }, { ...slot, id: "outside" }],
    changes: [
      change({ newDate: "2026-11-04" }),
      change({ slotId: "cancelled", kind: "cancelled" }),
      change({ slotId: "outside", newDate: "2026-11-05" }),
    ],
  });
  expect(eventLessons(data, "2026-11-04", "2026-11-04")).toEqual([
    expect.objectContaining({
      slotId: slot.id,
      occurrenceDate: "2026-11-02",
      date: "2026-11-04",
      startsAt: "2026-11-04T10:00:00.000Z",
    }),
  ]);
  expect(eventLessons(data, "2026-11-02", "2026-11-02")).toEqual([]);
});
it("нет пар в выходной", () =>
  expect(eventLessons(scheduleData(), "2026-11-08", "2026-11-08")).toEqual([]));
it("подложенный снимок игнорируется, остальные неизвестные поля запрещены", () => {
  expect(
    checkRequestPayload(
      eventType.fieldsSchema,
      {
        ...eventPayload,
        eventLessons: [{ slotId: "чужая пара" }],
      },
      false,
      now,
    ),
  ).toEqual({ success: true, payload: eventPayload });
  expect(
    checkRequestPayload(
      eventType.fieldsSchema,
      {
        ...eventPayload,
        studentId: "чужой",
      },
      false,
      now,
    ).success,
  ).toBe(false);
});
it("черновик допускает незаполненные даты, но не некорректный заполненный период", () => {
  expect(
    checkRequestPayload(
      eventType.fieldsSchema,
      { dateFrom: "", dateTo: "" },
      true,
    ).success,
  ).toBe(true);
  expect(
    checkRequestPayload(
      eventType.fieldsSchema,
      { dateFrom: "2026-11-01", dateTo: "2026-11-15" },
      true,
      now,
    ).success,
  ).toBe(false);
});

it.each([
  ["2026-10-22", "2026-10-22", true],
  ["2026-10-21", "2026-10-21", false],
  ["2027-01-04", "2027-01-04", true],
  ["2027-01-05", "2027-01-05", false],
  ["2026-11-05", "2026-11-18", true],
  ["2026-11-05", "2026-11-19", false],
])("окно дат на включительных границах %s–%s", (dateFrom, dateTo, valid) => {
  expect(eventDateErrors(dateFrom, dateTo, "2026-11-05") === null).toBe(valid);
  expect(
    checkRequestPayload(
      eventType.fieldsSchema,
      { ...eventPayload, dateFrom, dateTo },
      false,
      now,
    ).success,
  ).toBe(valid);
  const parse = () => parseEventPreview({ dateFrom, dateTo }, now);
  if (valid) expect(parse()).toEqual({ dateFrom, dateTo });
  else expect(parse).toThrow(ValidationError);
});
it("окно использует московский день на границе UTC-полуночи", () => {
  const moscowTomorrow = new Date("2026-11-05T21:00:00.000Z");
  expect(() =>
    parseEventPreview(
      { dateFrom: "2026-10-23", dateTo: "2026-10-23" },
      moscowTomorrow,
    ),
  ).not.toThrow();
  expect(() =>
    parseEventPreview(
      { dateFrom: "2026-10-22", dateTo: "2026-10-22" },
      moscowTomorrow,
    ),
  ).toThrow(ValidationError);
});
it.each(["0000-01-01", "0001-01-01", "1999-12-31", "2101-01-01", "9999-01-01"])(
  "неразумный год не попадает в PostgreSQL: %s",
  (date) => {
    expect(validEventDate(date)).toBe(false);
    expect(eventDateErrors(date, date)).not.toBeNull();
    expect(
      checkRequestPayload(
        eventType.fieldsSchema,
        { ...eventPayload, dateFrom: date, dateTo: date },
        false,
        now,
      ).success,
    ).toBe(false);
    expect(() =>
      parseEventPreview({ dateFrom: date, dateTo: date }, now),
    ).toThrow(ValidationError);
  },
);
it("разумные годы имеют явные доменные границы", () => {
  expect(EVENT_MIN_YEAR).toBe(2000);
  expect(EVENT_MAX_YEAR).toBe(2100);
  expect(validEventDate("2015-01-01")).toBe(true);
  expect(validEventDate("2100-12-31")).toBe(true);
});
it("заполненные даты без времени сервера отклоняются, включая неполный черновик", () => {
  expect(
    checkRequestPayload(eventType.fieldsSchema, eventPayload).success,
  ).toBe(false);
  expect(
    checkRequestPayload(
      eventType.fieldsSchema,
      { dateFrom: "2026-11-05" },
      true,
    ).success,
  ).toBe(false);
  expect(
    checkRequestPayload(eventType.fieldsSchema, { dateTo: "2026-11-05" }, true)
      .success,
  ).toBe(false);
  expect(
    checkRequestPayload(
      eventType.fieldsSchema,
      { dateFrom: "2026-10-21" },
      true,
      now,
    ).success,
  ).toBe(false);
  expect(
    checkRequestPayload(
      eventType.fieldsSchema,
      { dateTo: "2027-01-05" },
      true,
      now,
    ).success,
  ).toBe(false);
});
it.each(["\u0000", "\u0008", "\u001b", "\u007f"])(
  "название не принимает управляющий символ %j",
  (control) => {
    expect(
      checkRequestPayload(
        eventType.fieldsSchema,
        { ...eventPayload, eventName: `Хакатон${control}` },
        false,
        now,
      ).success,
    ).toBe(false);
  },
);
it("название очищается от Cf и пробелов, включая подмену направления", () => {
  expect(
    checkRequestPayload(
      eventType.fieldsSchema,
      { ...eventPayload, eventName: "  Хакатон\u202e «Импульс»\u200b  " },
      false,
      now,
    ),
  ).toEqual({
    success: true,
    payload: { ...eventPayload, eventName: "Хакатон «Импульс»" },
  });
});
it.each(["\u200b", " \u202e\u200b ", "   "])(
  "пустое после очистки название отклоняется и в черновике: %j",
  (eventName) => {
    expect(
      checkRequestPayload(eventType.fieldsSchema, { eventName }, true, now)
        .success,
    ).toBe(false);
    expect(
      checkRequestPayload(
        eventType.fieldsSchema,
        { ...eventPayload, eventName },
        false,
        now,
      ).success,
    ).toBe(false);
  },
);
it("пустой черновик названия допустим; переводы строк и табуляция следуют правилу комментария", () => {
  expect(
    checkRequestPayload(eventType.fieldsSchema, { eventName: "" }, true, now),
  ).toEqual({ success: true, payload: { eventName: "" } });
  expect(
    checkRequestPayload(
      eventType.fieldsSchema,
      { ...eventPayload, eventName: "Хакатон\nУчебный\tимпульс" },
      false,
      now,
    ).success,
  ).toBe(true);
});

it("оба клиентских снимка отбрасываются", () => {
  expect(
    checkRequestPayload(
      eventType.fieldsSchema,
      {
        ...eventPayload,
        eventLessons: [{ slotId: "foreign" }],
        submittedEventLessons: [{ slotId: "foreign" }],
      },
      false,
      new Date("2026-11-05T09:00:00Z"),
    ),
  ).toEqual({ success: true, payload: eventPayload });
});
