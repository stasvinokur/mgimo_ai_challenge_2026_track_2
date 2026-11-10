import { z } from "zod";
import {
  eventDateMessages,
  validEventDate,
} from "@/domain/requests/event-release";
import { requestStatuses } from "@/domain/requests/request-flow";
import { moscowDate } from "@/domain/schedule/dates";
import {
  type FieldErrors,
  NotFoundError,
  ValidationError,
} from "../shared/errors";
import type { RequestField } from "./ports";

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ValidationError(fieldErrors(result.error));
  return result.data;
}

function fieldErrors(error: z.ZodError): FieldErrors {
  return Object.fromEntries(
    Object.entries(z.flattenError(error).fieldErrors).filter(
      (entry): entry is [string, string[]] => Array.isArray(entry[1]),
    ),
  );
}

const id = z.uuid();
export function parseRequestId(input: unknown): string {
  const result = id.safeParse(input);
  if (!result.success) throw new NotFoundError();
  return result.data;
}
const payload = z.record(z.string().max(80), z.unknown());
export function parseCreateDraft(input: unknown) {
  return parse(
    z.strictObject({ typeCode: z.string().min(1).max(80), payload }),
    input,
  );
}
export function parseUpdateDraft(input: unknown) {
  return parse(z.strictObject({ id, payload }), input);
}
export const requestCommentSchema = z
  .string()
  .refine(
    (text) => !/\p{Cc}/u.test(text.replace(/[\n\t]/g, "")),
    "Уберите управляющие символы из комментария.",
  )
  .trim()
  .max(2000, "Не больше 2000 символов.")
  // Keep meaningful text unchanged; let request-flow reject an empty comment.
  .transform((text) => (text.replace(/\p{Cf}/gu, "").trim() ? text : ""));

export function parseStatusChange(input: unknown) {
  return parse(
    z.strictObject({
      id,
      to: z.enum(requestStatuses),
      comment: requestCommentSchema.optional(),
      commentCode: z.string().max(80).optional(),
    }),
    input,
  );
}
export function parseRequestForm(input: unknown) {
  return parse(
    z.strictObject({
      id: id.optional(),
      typeCode: z.string().min(1).max(80),
      payload,
      review: z.boolean(),
    }),
    input,
  );
}

const fieldSchema = z.strictObject({
  type: z.literal("string"),
  title: z.string(),
  format: z.literal("date").optional(),
  minLength: z.number().int().min(0).default(0),
  maxLength: z.number().int().min(1).max(10000).default(2000),
});
const fieldsSchema = z.object({
  type: z.literal("object"),
  properties: z.record(z.string(), fieldSchema),
  required: z.array(z.string()).default([]),
  fieldOrder: z.array(z.string()).optional(),
  additionalProperties: z.literal(false),
});

export function requestFields(schema: Record<string, unknown>): RequestField[] {
  const result = fieldsSchema.safeParse(schema);
  if (!result.success)
    throw new ValidationError({
      typeCode: ["requestFormUnavailable"],
    });
  const names = [
    ...new Set([
      ...(result.data.fieldOrder ?? []),
      ...Object.keys(result.data.properties),
    ]),
  ];
  return names.flatMap((name) => {
    if (!Object.hasOwn(result.data.properties, name)) return [];
    const value = result.data.properties[name];
    if (!value) return [];
    return [
      {
        name,
        title: value.title.replace(/\s*\(если известна\)$/, ""),
        minLength: value.minLength,
        maxLength: value.maxLength,
        required: result.data.required.includes(name),
        ...(value.format ? { format: value.format } : {}),
      },
    ];
  });
}

export function checkRequestPayload(
  schema: Record<string, unknown>,
  input: unknown,
  draft = false,
  now?: Date,
) {
  const shape: Record<string, z.ZodType> = {};
  for (const field of requestFields(schema)) {
    let value: z.ZodType<string> = z
      .string({ error: "requestRequired" })
      .max(field.maxLength, "requestTooLong");
    if (field.name === "eventName")
      value = value
        .refine(
          (text) => !/\p{Cc}/u.test(text.replace(/[\n\t]/g, "")),
          "requestEventNameControl",
        )
        .refine(
          (text) =>
            (draft && text === "") ||
            text.replace(/\p{Cf}/gu, "").trim().length > 0,
          "requestEventNameRequired",
        )
        .transform((text) => text.replace(/\p{Cf}/gu, "").trim());
    if (field.format === "date")
      value = value.refine(
        (text) => (draft && text === "") || validEventDate(text),
        "requestInvalidDate",
      );
    shape[field.name] = draft
      ? value.optional()
      : field.required
        ? value.refine(
            (text) => text.trim().length >= Math.max(1, field.minLength),
            "requestRequired",
          )
        : value
            .refine(
              (text) => text === "" || text.trim().length >= field.minLength,
              "requestInvalidValue",
            )
            .optional();
  }
  // Only the server creates the saved lesson snapshot.
  if (
    "eventName" in shape &&
    "dateFrom" in shape &&
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input)
  ) {
    const {
      eventLessons: _ignored,
      submittedEventLessons: _submitted,
      ...fields
    } = input as Record<string, unknown>;
    input = fields;
  }
  const result = z
    .strictObject(shape)
    .superRefine((data, context) => {
      const from =
        typeof data.dateFrom === "string" && data.dateFrom
          ? data.dateFrom
          : undefined;
      const to =
        typeof data.dateTo === "string" && data.dateTo
          ? data.dateTo
          : undefined;
      if (
        (from || to) &&
        requestFields(schema).some(
          (field) => field.name === "dateFrom" && field.format === "date",
        )
      ) {
        const errors =
          now && Number.isFinite(now.getTime())
            ? eventDateMessages(
                from ?? to ?? "",
                to ?? from ?? "",
                moscowDate(now),
              )
            : {
                dateFrom: [{ code: "requestPeriodUnavailable" }],
              };
        for (const [key, messages] of Object.entries(errors ?? {}))
          for (const message of messages)
            context.addIssue({
              code: "custom",
              path: [key],
              message: message.code,
            });
      }
    })
    .safeParse(input);
  if (!result.success)
    return { success: false as const, fieldErrors: fieldErrors(result.error) };
  return {
    success: true as const,
    payload: Object.fromEntries(
      Object.entries(result.data).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  };
}

export function validateRequestPayload(
  schema: Record<string, unknown>,
  input: unknown,
  draft = false,
  now?: Date,
): Record<string, string> {
  const result = checkRequestPayload(schema, input, draft, now);
  if (!result.success) throw new ValidationError(result.fieldErrors);
  return result.payload;
}

export function parseEventPreview(input: unknown, now: Date) {
  return parse(
    z
      .strictObject({ dateFrom: z.iso.date(), dateTo: z.iso.date() })
      .superRefine((data, context) => {
        const errors = eventDateMessages(
          data.dateFrom,
          data.dateTo,
          moscowDate(now),
        );
        for (const [key, messages] of Object.entries(errors ?? {}))
          for (const message of messages)
            context.addIssue({
              code: "custom",
              path: [key],
              message: message.code,
            });
      }),
    input,
  );
}

export function savedEventLessons(payload: Record<string, unknown>) {
  const result = z
    .array(
      z.object({
        slotId: z.string(),
        occurrenceDate: z.iso.date(),
        date: z.iso.date(),
        course: z.string(),
        startsAt: z.iso.datetime(),
        endsAt: z.iso.datetime(),
        room: z.string(),
      }),
    )
    .safeParse(payload.eventLessons);
  return result.success ? result.data : [];
}

export { EVENT_RELEASE_TYPE } from "@/domain/requests/event-release";

export function parsePickupBooking(input: unknown) {
  return parse(
    z.strictObject({
      id,
      windowId: id,
      slotStartsAt: z.iso
        .datetime()
        .transform((value) => new Date(value).toISOString()),
    }),
    input,
  );
}

export function parsePickupId(input: unknown) {
  return parse(z.strictObject({ id }), input);
}

export function parsePickupStaffChange(input: unknown) {
  return parse(
    z.strictObject({ id, to: z.enum(["called", "served", "no_show"]) }),
    input,
  );
}
