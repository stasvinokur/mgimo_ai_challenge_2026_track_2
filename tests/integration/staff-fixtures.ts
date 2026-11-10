import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import type { Actor } from "@/application/ports/actor";
import {
  ChangeRequestStatus,
  SubmitRequest,
} from "@/application/requests/change-request-status";
import { CreateRequestDraft } from "@/application/requests/drafts";
import { ChangeStaffRequestStatus } from "@/application/staff/change-status";
import {
  GetStaffRequest,
  ListStaffRequests,
} from "@/application/staff/queries";
import { Argon2PasswordHasher } from "@/infrastructure/auth/argon2-password-hasher";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresSessionStore } from "@/infrastructure/db/repositories/identity/sessions";
import { PostgresIdentityRepository } from "@/infrastructure/db/repositories/identity/users";
import { DrizzleStaffRequestRepository } from "@/infrastructure/db/repositories/requests/staff-repository";
import { DrizzleStaffUnitOfWork } from "@/infrastructure/db/repositories/requests/staff-unit-of-work";
import { DrizzleRequestsUnitOfWork } from "@/infrastructure/db/repositories/requests/unit-of-work";
import * as schema from "@/infrastructure/db/schema";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { FakeClock } from "../fakes/clock";
import { openStudentTestData, type StudentTestData } from "./student-e2e-data";

export async function openStaffFixture() {
  const students: StudentTestData[] = [];
  try {
    const anna = await openStudentTestData("anna");
    students.push(anna);
    const timur = await openStudentTestData("timur");
    students.push(timur);
    const fixture = await createStaffFixture(anna.actor, timur.actor);
    return {
      ...fixture,
      studentCredentials: { anna: anna.credentials, timur: timur.credentials },
      async close() {
        try {
          await fixture.close();
        } finally {
          await Promise.all(students.map((student) => student.close()));
        }
      },
    };
  } catch (error) {
    await Promise.all(students.map((student) => student.close()));
    throw error;
  }
}

async function createStaffFixture(anna: Actor, timur: Actor) {
  const sql = createDatabase(5);
  const ids = new UuidV7Generator();
  const clock = new FakeClock(new Date().toISOString());
  const marker = `Тест кабинета сотрудника · ${randomUUID()}`;
  const identity = new PostgresIdentityRepository(() => sql);
  async function actor(login: string) {
    const user = await identity.findCredentials(login);
    const result = user && (await identity.findActorByUserId(user.userId));
    if (!result) throw new Error("Нужен демо-сид тестовой БД.");
    return result;
  }
  const demoMarina = await actor("marina");
  if (
    anna.kind !== "student" ||
    timur.kind !== "student" ||
    demoMarina.kind !== "staff"
  )
    throw new Error("Неверные роли демо-аккаунтов.");
  const marinaUserId = ids.next(),
    marinaStaffId = ids.next();
  const marinaCredentials = {
    login: `staff-test-${marinaUserId}`,
    password: "staff-test-demo-2026",
  };
  const marinaPasswordHash = await new Argon2PasswordHasher().hash(
    marinaCredentials.password,
  );
  await sql`insert into users (id, login, password_hash, role) values (${marinaUserId}, ${marinaCredentials.login}, ${marinaPasswordHash}, 'staff')`;
  await sql`insert into staff (id, user_id, full_name)
    select ${marinaStaffId}, ${marinaUserId}, full_name from staff where user_id = ${demoMarina.userId}`;
  for (const facultyId of demoMarina.facultyIds)
    await sql`insert into staff_faculties (staff_id, faculty_id) values (${marinaStaffId}, ${facultyId})`;
  const marina: Actor = {
    ...demoMarina,
    userId: marinaUserId,
    staffId: marinaStaffId,
  };
  const userId = ids.next(),
    staffId = ids.next();
  const limitedCredentials = {
    login: `staff-test-${userId}`,
    password: "staff-test-demo-2026",
  };
  const passwordHash = await new Argon2PasswordHasher().hash(
    limitedCredentials.password,
  );
  await sql`insert into users (id, login, password_hash, role) values (${userId}, ${limitedCredentials.login}, ${passwordHash}, 'staff')`;
  await sql`insert into staff (id, user_id, full_name) values (${staffId}, ${userId}, 'Учебный сотрудник')`;
  await sql`insert into staff_faculties (staff_id, faculty_id) values (${staffId}, ${anna.facultyId})`;
  const limited: Actor = {
    kind: "staff",
    userId,
    staffId,
    facultyIds: [anna.facultyId],
  };
  const uow = new DrizzleStaffUnitOfWork(() => sql, ids);
  const requestUow = new DrizzleRequestsUnitOfWork(() => sql);
  const studentChange = new ChangeRequestStatus(requestUow, clock, ids);
  const create = new CreateRequestDraft(requestUow, clock, ids);
  const submit = new SubmitRequest(studentChange);
  const logger = { info() {}, warn() {}, error() {} };
  const change = new ChangeStaffRequestStatus(uow, clock, ids, logger);
  const repo = new DrizzleStaffRequestRepository(() =>
    drizzle(sql, { schema }),
  );
  const list = new ListStaffRequests(repo, clock),
    get = new GetStaffRequest(repo, clock);
  const sessions = new PostgresSessionStore(() => sql);
  const sessionIds: string[] = [];
  const created: string[] = [];
  return {
    sql,
    ids,
    clock,
    marker,
    anna,
    timur,
    marina,
    marinaCredentials,
    limited,
    limitedCredentials,
    uow,
    repo,
    list,
    get,
    change,
    logger,
    studentChange,
    async request(owner: Actor = anna, draft = false) {
      const request = await create.execute(owner, {
        typeCode: "enrollment",
        payload: { destination: marker },
      });
      created.push(request.id);
      if (!draft) await submit.execute(owner, request);
      return request.id;
    },
    async session(actor: Actor) {
      const tokens = new CryptoSessionTokens(),
        token = tokens.generate(),
        id = ids.next();
      const at = new Date().toISOString();
      await sessions.create({
        id,
        userId: actor.userId,
        tokenHash: tokens.hash(token),
        createdAt: at,
        lastSeenAt: at,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      sessionIds.push(id);
      return token;
    },
    async close() {
      try {
        await sql.begin(async (tx) => {
          const rows = await tx<
            { id: string }[]
          >`select id from requests where seed_key is null and (payload->>'destination' = ${marker} or id = any(${created}::uuid[]))`;
          for (const { id } of rows) {
            await tx`delete from staff_audit_log where request_id = ${id}`;
            await tx`delete from notifications where link = ${`/requests/${id}`}`;
            await tx`delete from certificates where request_id = ${id}`;
            await tx`delete from requests where id = ${id}`;
          }
          for (const id of sessionIds)
            await tx`delete from sessions where id = ${id}`;
          await tx`delete from sessions where user_id = ${userId}`;
          await tx`delete from staff_audit_log where staff_user_id = ${userId}`;
          await tx`delete from staff_faculties where staff_id = ${staffId}`;
          await tx`delete from staff where id = ${staffId}`;
          await tx`delete from users where id = ${userId}`;
          await tx`delete from sessions where user_id = ${marinaUserId}`;
          await tx`delete from staff_audit_log where staff_user_id = ${marinaUserId}`;
          await tx`delete from staff_faculties where staff_id = ${marinaStaffId}`;
          await tx`delete from staff where id = ${marinaStaffId}`;
          await tx`delete from users where id = ${marinaUserId}`;
        });
      } finally {
        await sql.end({ timeout: 1 });
      }
    },
  };
}
export type StaffFixture = Awaited<ReturnType<typeof openStaffFixture>>;
