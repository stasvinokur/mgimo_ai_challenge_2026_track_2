import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { GetEventReleaseBasis } from "@/application/requests/event-release-basis";
import { NotFoundError } from "@/application/shared/errors";
import { GetStaffRequest } from "@/application/staff/queries";
import { PostgresRegulations } from "@/infrastructure/db/repositories/regulations/repository";
import { EventLessonList } from "@/ui/requests/event-lessons";
import { openEventRequestFixture } from "./requests-event-data";

it("сотрудник видит актуальные пары/отметки и прошлый период; одобрение использует тот же исходный ключ", async () => {
  const f = await openEventRequestFixture();
  if (f.anna.kind !== "student") throw new Error("Нужен студент");
  const studentId = f.anna.studentId;
  const groupId = f.ids.next(),
    slotId = f.ids.next();
  const [original] = await f.sql<
    { groupId: string }[]
  >`select group_id as "groupId" from students where id = ${studentId}`;
  if (!original) throw new Error("Нет группы");
  try {
    f.clock.set("2026-11-05T09:00:00.000Z");
    f.payload.dateFrom = "2026-11-02";
    f.payload.dateTo = "2026-11-03";
    await f.sql`insert into groups (id, program_id, title) select ${groupId}, program_id, ${`ТЕСТ-${groupId}`} from students where id = ${studentId}`;
    await f.sql`insert into schedule_slots (id, group_id, course_id, teacher_id, room_id, weekday, starts_at, ends_at, kind, week_parity)
      select ${slotId}, ${groupId}, course_id, teacher_id, room_id, 1, '09:00', '10:30', kind, 'any' from schedule_slots where group_id = ${original.groupId} limit 1`;
    await f.sql`update students set group_id = ${groupId} where id = ${studentId}`;
    const id = await f.createEvent();
    const get = new GetStaffRequest(f.repo, f.clock);
    const initial = await get.execute(f.limited, { id });
    expect(initial.eventReview).toMatchObject({
      past: true,
      changed: false,
      lessons: [
        expect.objectContaining({
          slotId,
          occurrenceDate: "2026-11-02",
          attendanceStatus: null,
        }),
      ],
    });
    await f.sql`insert into schedule_changes (id, slot_id, date, kind, new_date, new_starts_at, new_ends_at, reason, created_at)
      values (${f.ids.next()}, ${slotId}, '2026-11-02', 'moved', '2026-11-03', '13:00', '14:30', 'Учебный перенос', '2026-11-05T09:00:00Z')`;
    await f.sql`insert into attendance_records (id, student_id, slot_id, occurrence_date, status, source, source_key, marked_at)
      values (${f.ids.next()}, ${studentId}, ${slotId}, '2026-11-02', 'absent', 'demo', ${`test:${id}`}, '2026-11-02T07:30:00Z')`;
    const current = await get.execute(f.limited, { id });
    expect(current.eventReview).toMatchObject({
      past: true,
      changed: true,
      lessons: [
        expect.objectContaining({
          slotId,
          occurrenceDate: "2026-11-02",
          date: "2026-11-03",
          startsAt: "2026-11-03T10:00:00.000Z",
          attendanceStatus: "absent",
        }),
      ],
    });
    const html = renderToStaticMarkup(
      createElement(EventLessonList, {
        audience: "staff",
        basis: await new GetEventReleaseBasis(
          new PostgresRegulations(() => f.sql),
        ).execute(f.limited),
        typeCode: current.type.code,
        payload: current.payload,
        review: current.eventReview,
      }),
    );
    expect(html).toContain("Период в прошлом");
    expect(html).toContain("изменилось после подачи");
    expect(html).toContain("Статус сейчас: Отсутствие");
    const expectedTime = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date("2026-11-03T10:00:00Z"));
    expect(html).toContain(expectedTime);
    expect((await f.get.execute(f.anna, { id })).payload.eventLessons).toEqual(
      initial.payload.eventLessons,
    );
    const foreign = {
      ...f.limited,
      kind: "staff" as const,
      staffId: f.limited.kind === "staff" ? f.limited.staffId : "",
      facultyIds: [f.timur.kind === "student" ? f.timur.facultyId : ""],
    };
    await expect(get.execute(foreign, { id })).rejects.toThrow(NotFoundError);
    expect(
      await f.repo.findEventContextForFaculties(id, foreign.facultyIds),
    ).toBeNull();
    await f.progress(id);
    await f.change.execute(f.limited, { id, to: "ready" });
    const [marked] =
      await f.sql`select occurrence_date::text, status, reason from attendance_records where student_id = ${studentId} and slot_id = ${slotId}`;
    expect(marked).toMatchObject({
      occurrence_date: "2026-11-02",
      status: "excused",
      reason: f.payload.eventName,
    });
    expect(
      (await get.execute(f.limited, { id })).eventReview?.lessons[0]
        ?.attendanceStatus,
    ).toBe("excused");
    const approved = await get.execute(f.limited, { id });
    expect(approved.eventReview?.changed).toBe(true);
    expect(approved.payload.submittedEventLessons).toEqual(
      initial.payload.eventLessons,
    );
  } finally {
    try {
      await f.sql`delete from attendance_records where slot_id = ${slotId}`;
      await f.sql`delete from schedule_changes where slot_id = ${slotId}`;
      await f.sql`update students set group_id = ${original.groupId} where id = ${studentId}`;
      await f.sql`delete from schedule_slots where id = ${slotId}`;
      await f.sql`delete from groups where id = ${groupId}`;
    } finally {
      await f.close();
    }
  }
});
