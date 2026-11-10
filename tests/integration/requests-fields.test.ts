import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, expect, it } from "vitest";
import { typeDto } from "@/application/requests/dto";
import { requestFields } from "@/application/requests/schemas";
import { createDatabase } from "@/infrastructure/db/client";
import { DrizzleRequestRepository } from "@/infrastructure/db/repositories/requests/repository";
import * as schema from "@/infrastructure/db/schema";
import { requestFixtures } from "../../scripts/fixtures/requests";
import { fixtureContext } from "../../scripts/fixtures/shared";
import { FakeClock } from "../fakes/clock";
import { SequentialIdGenerator } from "../fakes/id-generator";

const sql = createDatabase(1);
const repo = new DrizzleRequestRepository(() => drizzle(sql, { schema }));
const catalog = requestFixtures(
  fixtureContext(
    new FakeClock("2026-11-05T09:00:00Z"),
    new SequentialIdGenerator(),
  ),
).requestTypes;
afterAll(() => sql.end({ timeout: 1 }));

async function roundTrip(type: (typeof catalog)[number]) {
  const code = `request-fields-${randomUUID()}`;
  try {
    await sql`insert into request_types (code, title, description, sla_work_days, delivery, fields_schema, is_certificate)
      values (${code}, ${type.title}, ${type.description}, ${type.slaWorkDays}, ${type.delivery}, ${sql.json(type.fieldsSchema)}, ${type.isCertificate})`;
    const result = await repo.findType(code);
    if (!result) throw new Error("Не удалось прочитать временный тип заявки.");
    return result;
  } finally {
    await sql`delete from request_types where code = ${code}`;
  }
}

it("PostgreSQL jsonb меняет properties, но явный порядок освобождения остаётся в DTO", async () => {
  const event = catalog.find((type) => type.code === "event_release");
  if (!event) throw new Error("Нет типа освобождения.");
  const stored = await roundTrip(event);
  const expectedOrder = [
    "eventName",
    "organizer",
    "dateFrom",
    "dateTo",
    "eventFormat",
    "confirmation",
  ];
  expect(
    Object.keys(stored.fieldsSchema.properties as Record<string, unknown>),
  ).not.toEqual(expectedOrder);
  expect(stored.fieldsSchema.fieldOrder).toEqual(expectedOrder);
  expect(requestFields(stored.fieldsSchema).map((field) => field.name)).toEqual(
    expectedOrder,
  );
  expect(typeDto(stored).fields.map((field) => field.title)).toEqual([
    "Название мероприятия",
    "Организатор",
    "Дата с",
    "Дата по",
    "Формат участия",
    "Подтверждение: ссылка или текст приглашения",
  ]);
});

it("PostgreSQL: прежние типы без metadata сохраняют текущий порядок jsonb", async () => {
  for (const code of [
    "enrollment",
    "military",
    "visa",
    "scholarship",
    "retake",
    "academic_leave",
    "question",
  ]) {
    const type = catalog.find((type) => type.code === code);
    if (!type) throw new Error("Нет прежнего типа заявки.");
    const stored = await roundTrip(type);
    expect(stored.fieldsSchema).not.toHaveProperty("fieldOrder");
    expect(typeDto(stored).fields.map((field) => field.name)).toEqual(
      Object.keys(stored.fieldsSchema.properties as Record<string, unknown>),
    );
  }
});

it("PostgreSQL: бумажная справка сохраняет явный порядок полей в DTO", async () => {
  const paper = catalog.find((type) => type.code === "enrollment_paper");
  if (!paper) throw new Error("Нет типа бумажной справки.");
  const stored = await roundTrip(paper);
  expect(stored.fieldsSchema.fieldOrder).toEqual(["destination"]);
  expect(typeDto(stored).fields.map((field) => field.name)).toEqual([
    "destination",
  ]);
  expect(typeDto(stored).fields.map((field) => field.title)).toEqual([
    "Место требования",
  ]);
});
