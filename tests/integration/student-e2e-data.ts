import type { Actor } from "@/application/ports/actor";
import { Argon2PasswordHasher } from "@/infrastructure/auth/argon2-password-hasher";
import { createDatabase } from "@/infrastructure/db/client";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";

export type StudentScenario = "anna" | "timur";

export async function openStudentTestData(scenario: StudentScenario) {
  const sql = createDatabase(1);
  const ids = new UuidV7Generator();
  const userId = ids.next();
  const studentId = ids.next();
  const credentials = {
    login: `student-test-${userId}`,
    password: "student-test-demo-2026",
  };
  const passwordHash = await new Argon2PasswordHasher().hash(
    credentials.password,
  );
  try {
    const actor = await sql.begin(async (tx) => {
      const [source] = await tx<
        { id: string; userId: string; facultyId: string }[]
      >`
        select s.id, s.user_id as "userId", s.faculty_id as "facultyId"
        from students s join users u on u.id = s.user_id where u.login = ${scenario}`;
      if (!source) throw new Error("Нужен демо-сид тестовой БД.");
      await tx`insert into users (id, login, password_hash, role)
        values (${userId}, ${credentials.login}, ${passwordHash}, 'student')`;
      await tx`insert into students (id, user_id, full_name, faculty_id, program_id, course, group_id, record_book_no, scholarship, target_score)
        select ${studentId}, ${userId}, full_name, faculty_id, program_id, course, group_id, ${`DEMO-${studentId.slice(-12)}`}, scholarship, target_score
        from students where id = ${source.id}`;
      // Copy only immutable seed rows; parallel tests may have added other rows.
      const scores = await tx<
        { id: string }[]
      >`select id from scores where student_id = ${source.id} and seed_key is not null`;
      for (const row of scores)
        await tx`insert into scores (id, assessment_id, student_id, score, graded_at)
          select ${ids.next()}, assessment_id, ${studentId}, score, graded_at from scores where id = ${row.id}`;
      const requests = await tx<
        { id: string }[]
      >`select id from requests where student_id = ${source.id} and seed_key is not null`;
      const requestLinks = new Map<string, string>();
      for (const row of requests) {
        const id = ids.next();
        requestLinks.set(`/requests/${row.id}`, `/requests/${id}`);
        await tx`insert into requests (id, public_no, student_id, type_code, payload, status, assignee_staff_id, submitted_at, due_at, created_at, updated_at)
          select ${id}, ${`ТЕСТ-${id.slice(-12)}`}, ${studentId}, type_code, payload, status, assignee_staff_id, submitted_at, due_at, created_at, updated_at
          from requests where id = ${row.id}`;
        const events = await tx<
          { id: string }[]
        >`select id from request_events where request_id = ${row.id} and seed_key is not null`;
        for (const event of events)
          await tx`insert into request_events (id, request_id, from_status, to_status, actor_user_id, comment, at)
            select ${ids.next()}, ${id}, from_status, to_status,
              case when actor_user_id = ${source.userId} then ${userId}::uuid else actor_user_id end, comment, at
            from request_events where id = ${event.id}`;
      }
      const notifications = await tx<{ id: string; link: string }[]>`
        select id, link from notifications where user_id = ${source.userId} and seed_key is not null`;
      for (const row of notifications)
        await tx`insert into notifications (id, user_id, kind, priority, title, body, link, read_at, created_at)
          select ${ids.next()}, ${userId}, kind, priority, title, body, ${requestLinks.get(row.link) ?? row.link}, null, created_at
          from notifications where id = ${row.id}`;
      return {
        kind: "student",
        userId,
        studentId,
        facultyId: source.facultyId,
      } satisfies Actor;
    });
    return {
      actor,
      credentials,
      async close() {
        try {
          await sql.begin(async (tx) => {
            await tx`select id from students where id = ${studentId} for update`;
            await tx`select id from users where id = ${userId} for update`;
            await tx`delete from staff_audit_log where request_id in (select id from requests where student_id = ${studentId})`;
            await tx`delete from certificates where request_id in (select id from requests where student_id = ${studentId})`;
            await tx`delete from requests where student_id = ${studentId}`;
            await tx`delete from notifications where user_id = ${userId}`;
            await tx`delete from scores where student_id = ${studentId}`;
            await tx`delete from calendar_tokens where student_id = ${studentId}`;
            await tx`delete from students where id = ${studentId}`;
            await tx`delete from assistant_log where user_id = ${userId}`;
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

export type StudentTestData = Awaited<ReturnType<typeof openStudentTestData>>;
