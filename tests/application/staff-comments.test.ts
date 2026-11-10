import { expect, it } from "vitest";
import {
  ChangeRequestStatus,
  SubmitRequest,
} from "@/application/requests/change-request-status";
import { CreateRequestDraft } from "@/application/requests/drafts";
import { ValidationError } from "@/application/shared/errors";
import { ChangeStaffRequestStatus } from "@/application/staff/change-status";
import { FakeClock } from "../fakes/clock";
import { SequentialIdGenerator } from "../fakes/id-generator";
import { anna, marina } from "../fakes/identity";
import { FakeStaff } from "../fakes/staff";

async function comments(role: "student" | "staff") {
  const db = new FakeStaff(),
    clock = new FakeClock("2026-11-04T09:00:00Z"),
    ids = new SequentialIdGenerator();
  const student = new ChangeRequestStatus(db.requests, clock, ids);
  const staff = new ChangeStaffRequestStatus(db, clock, ids, {
    info() {},
    warn() {},
    error() {},
  });
  const { id } = await new CreateRequestDraft(db.requests, clock, ids).execute(
    anna,
    {
      typeCode: "enrollment",
      payload: { destination: "Учебный центр «Меридиан»" },
    },
  );
  await new SubmitRequest(student).execute(anna, { id });
  await staff.execute(marina, { id, to: "accepted" });
  await staff.execute(marina, { id, to: "in_progress" });
  if (role === "student")
    await staff.execute(marina, {
      id,
      to: "needs_info",
      comment: "Уточните место требования.",
    });
  return {
    db,
    execute: (comment: string) =>
      role === "staff"
        ? staff.execute(marina, { id, to: "needs_info", comment })
        : student.execute(anna, { id, to: "in_progress", comment }),
  };
}

for (const role of ["student", "staff"] as const) {
  it(`${role}: Cc, включая NUL, дают ValidationError до изменения заявки`, async () => {
    const { db, execute } = await comments(role);
    const before = structuredClone({
      records: db.requests.records,
      events: db.requests.events,
      notifications: db.requests.notifications,
      audit: db.audit,
    });
    for (let code = 0; code <= 159; code++) {
      if ((code > 31 && code < 127) || code === 9 || code === 10) continue;
      for (const text of [
        `a${String.fromCodePoint(code)}b`,
        `${String.fromCodePoint(code)} Текст `,
      ]) {
        await expect(execute(text)).rejects.toBeInstanceOf(ValidationError);
        await expect(execute(text)).rejects.toMatchObject({
          fieldErrors: {
            comment: ["Уберите управляющие символы из комментария."],
          },
        });
      }
    }
    expect({
      records: db.requests.records,
      events: db.requests.events,
      notifications: db.requests.notifications,
      audit: db.audit,
    }).toEqual(before);
  });
  it(`${role}: пробелы, zero-width и bidi без текста не выполняют требование комментария`, async () => {
    const { db, execute } = await comments(role);
    const events = db.requests.events.length;
    for (const text of [
      "",
      " \n\t ",
      "\u200b",
      " \u200c\u200d\t",
      "\u202a\u202c",
      "\u2066 \u2069",
      "\u200e\u200f",
      "\ufeff",
    ]) {
      await expect(execute(text)).rejects.toBeInstanceOf(ValidationError);
      await expect(execute(text)).rejects.toMatchObject({
        fieldErrors: { comment: ["Добавьте комментарий."] },
      });
    }
    expect(db.requests.events).toHaveLength(events);
  });
  it(`${role}: осмысленный комментарий сохраняет строки, табуляцию и форматирование`, async () => {
    const { db, execute } = await comments(role);
    const text = "Место требования:\n\tУчебный центр «Меридиан»\u200d.";
    await execute(`  ${text}  `);
    expect(db.requests.events.at(-1)?.comment).toBe(text);
  });
}
