import { randomUUID } from "node:crypto";
import { createDatabase } from "@/infrastructure/db/client";

// Isolate the student's group so time-based tests never change a demo schedule.
export async function openTodaySchedule(studentId: string) {
  const sql = createDatabase(1);
  const groupId = randomUUID();
  const startsAt = new Date(
    Math.ceil(Date.now() / 60_000) * 60_000 + 10 * 60_000,
  );
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const start = clock.format(startsAt);
  const end =
    start < "23:29:00"
      ? clock.format(new Date(startsAt.getTime() + 30 * 60_000))
      : "23:59:59";
  try {
    const original = await sql.begin(async (tx) => {
      const [student] = await tx<
        { groupId: string }[]
      >`select group_id as "groupId" from students where id = ${studentId}`;
      if (!student) throw new Error("Нужен временный студент.");
      await tx`insert into groups (id, program_id, title) select ${groupId}, program_id, ${`ДЕМО-пульс-${groupId}`} from students where id = ${studentId}`;
      for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
        await tx`insert into schedule_slots (id, group_id, course_id, teacher_id, room_id, weekday, starts_at, ends_at, kind, week_parity)
          select ${randomUUID()}, ${groupId}, course_id, teacher_id, room_id, ${weekday}, ${start}, ${end}, kind, 'any'
          from schedule_slots where seed_key is not null order by id limit 1`;
      }
      await tx`update students set group_id = ${groupId} where id = ${studentId}`;
      return student.groupId;
    });
    return {
      startsAt,
      async close() {
        try {
          await sql.begin(async (tx) => {
            await tx`update students set group_id = ${original} where id = ${studentId}`;
            await tx`delete from schedule_slots where group_id = ${groupId}`;
            await tx`delete from groups where id = ${groupId}`;
          });
        } finally {
          await sql.end({ timeout: 1 });
        }
      },
    };
  } catch (error) {
    await sql.end({ timeout: 1 });
    throw error;
  }
}
