import type { Actor } from "@/application/ports/actor";
import { moscowDate, weekday } from "@/domain/schedule/dates";
import { Argon2PasswordHasher } from "@/infrastructure/auth/argon2-password-hasher";
import { createDatabase } from "@/infrastructure/db/client";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";

export async function openTeacherTestData(
  options: { fullName?: string; groupTitle?: string } = {},
) {
  const sql = createDatabase(3);
  const ids = new UuidV7Generator();
  const userId = ids.next(),
    teacherId = ids.next(),
    groupId = ids.next(),
    slotId = ids.next();
  const credentials = {
    login: `teacher-test-${userId}`,
    password: "teacher-test-demo-2026",
  };
  const hash = await new Argon2PasswordHasher().hash(credentials.password);
  try {
    await sql.begin(async (tx) => {
      await tx`insert into users (id, login, password_hash, role) values (${userId}, ${credentials.login}, ${hash}, 'teacher')`;
      await tx`insert into teachers (id, user_id, full_name) values (${teacherId}, ${userId}, ${options.fullName ?? "Учебный преподаватель"})`;
      await tx`insert into groups (id, program_id, title) select ${groupId}, program_id, ${options.groupTitle ?? `Учебная группа ${groupId}`} from groups where seed_key = 'demo:group:fmo'`;
      await tx`insert into schedule_slots (id, group_id, course_id, teacher_id, room_id, weekday, starts_at, ends_at, kind, week_parity)
        select ${slotId}, ${groupId}, course_id, ${teacherId}, room_id, ${weekday(moscowDate(new Date()))}, '09:00', '10:30', kind, 'any' from schedule_slots where seed_key = 'demo:slot:fmo:4:0'`;
    });
    return {
      sql,
      ids,
      credentials,
      groupId,
      slotId,
      actor: { kind: "teacher", userId, teacherId } satisfies Actor,
      async close() {
        try {
          await sql.begin(async (tx) => {
            await tx`delete from attendance_codes where teacher_id = ${teacherId} or slot_id in (select id from schedule_slots where teacher_id = ${teacherId})`;
            await tx`delete from attendance_records where slot_id in (select id from schedule_slots where teacher_id = ${teacherId})`;
            await tx`delete from schedule_changes where slot_id in (select id from schedule_slots where teacher_id = ${teacherId})`;
            await tx`delete from schedule_slots where teacher_id = ${teacherId}`;
            await tx`delete from teachers where id = ${teacherId}`;
            await tx`delete from groups where id = ${groupId}`;
            await tx`delete from users where id = ${userId}`;
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

export type TeacherTestData = Awaited<ReturnType<typeof openTeacherTestData>>;
