import { expect, it } from "vitest";
import { typeDto } from "@/application/requests/dto";
import { requestFields } from "@/application/requests/schemas";
import { requestFixtures } from "../../scripts/fixtures/requests";
import { fixtureContext } from "../../scripts/fixtures/shared";
import { FakeClock } from "../fakes/clock";
import { SequentialIdGenerator } from "../fakes/id-generator";
import { eventType } from "../fakes/requests-event";

const expectedEventOrder = [
  "eventName",
  "organizer",
  "dateFrom",
  "dateTo",
  "eventFormat",
  "confirmation",
];

it("старое освобождение без fieldOrder использует сохранённый порядок required", () => {
  const { fieldOrder: _order, ...legacy } = eventType.fieldsSchema;
  const properties = legacy.properties as Record<string, unknown>;
  const dto = typeDto({
    ...eventType,
    fieldsSchema: {
      ...legacy,
      properties: Object.fromEntries(Object.entries(properties).reverse()),
    },
  });
  expect(dto.fields.map((field) => field.name)).toEqual(expectedEventOrder);
});

it("явный порядок освобождения не зависит от порядка properties", () => {
  const properties = eventType.fieldsSchema.properties as Record<
    string,
    unknown
  >;
  const schema = {
    ...eventType.fieldsSchema,
    properties: Object.fromEntries(Object.entries(properties).reverse()),
  };
  expect(requestFields(schema).map((field) => field.name)).toEqual(
    expectedEventOrder,
  );
  expect(
    requestFields(schema)
      .filter((field) => field.format === "date")
      .map((field) => field.name),
  ).toEqual(["dateFrom", "dateTo"]);
});

it("неперечисленные необязательные поля добавляются после явного порядка без потерь и дублей", () => {
  const schema = {
    type: "object",
    properties: {
      optional: { type: "string", title: "Необязательное поле" },
      first: { type: "string", title: "Первое поле" },
      last: { type: "string", title: "Последнее поле" },
    },
    required: ["first"],
    fieldOrder: ["first", "first", "unknown", "constructor", "__proto__"],
    additionalProperties: false,
  };
  expect(
    requestFields(schema).map(({ name, required }) => ({ name, required })),
  ).toEqual([
    { name: "first", required: true },
    { name: "optional", required: false },
    { name: "last", required: false },
  ]);
});

it("у прежних типов нет нового порядка и сохраняется исходный порядок properties", () => {
  const catalog = requestFixtures(
    fixtureContext(
      new FakeClock("2026-11-05T09:00:00Z"),
      new SequentialIdGenerator(),
    ),
  ).requestTypes;
  const legacyCodes = new Set([
    "enrollment",
    "military",
    "visa",
    "scholarship",
    "retake",
    "academic_leave",
    "question",
  ]);
  for (const type of catalog.filter((type) => legacyCodes.has(type.code))) {
    expect(type.fieldsSchema).not.toHaveProperty("fieldOrder");
    expect(requestFields(type.fieldsSchema).map((field) => field.name)).toEqual(
      Object.keys(type.fieldsSchema.properties),
    );
  }
});
