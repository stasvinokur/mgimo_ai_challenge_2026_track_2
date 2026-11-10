import { drizzle } from "drizzle-orm/postgres-js";
import type { Actor } from "@/application/ports/actor";
import {
  BookRequestPickup,
  CancelRequestPickup,
  GetRequestPickup,
} from "@/application/requests/pickup";
import { ChangeStaffPickup, ListStaffPickup } from "@/application/staff/pickup";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresRateLimiter } from "@/infrastructure/db/repositories/identity/rate-limiter";
import { PostgresPickupRepository } from "@/infrastructure/db/repositories/requests/pickup-repository";
import { DrizzleRequestRepository } from "@/infrastructure/db/repositories/requests/repository";
import { DrizzleRequestsUnitOfWork } from "@/infrastructure/db/repositories/requests/unit-of-work";
import * as schema from "@/infrastructure/db/schema";
import { openStaffFixture } from "./staff-fixtures";
import { openStudentTestData } from "./student-e2e-data";

export function pickupToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export async function openPickupFixture(
  options: {
    studentNames?: readonly [string, string];
    staffName?: string;
    windowTitle?: string;
    destination?: string;
  } = {},
) {
  const f = await openStaffFixture();
  let second: Awaited<ReturnType<typeof openStudentTestData>> | undefined;
  const windows: string[] = [];
  const facultyIds: string[] = [];
  async function deleteFaculties() {
    const cleanup = createDatabase(1);
    try {
      if (facultyIds.length)
        await cleanup`delete from faculties where id = any(${facultyIds}::uuid[])`;
    } finally {
      await cleanup.end({ timeout: 1 });
    }
  }
  try {
    second = await openStudentTestData("anna");
    const another = second;
    const marker = options.destination ?? f.marker;
    const ownFacultyId = f.ids.next(),
      foreignFacultyId = f.ids.next();
    const foreignMarker = `Чужой факультет · ${foreignFacultyId}`;
    await f.sql.begin(async (tx) => {
      if (options.studentNames) {
        await tx`update students set full_name = ${options.studentNames[0]} where id = ${f.anna.studentId}`;
        await tx`update students set full_name = ${options.studentNames[1]} where id = ${another.actor.studentId}`;
      }
      if (options.staffName)
        await tx`update staff set full_name = ${options.staffName} where id = ${f.limited.staffId}`;
      for (const id of [ownFacultyId, foreignFacultyId])
        await tx`insert into faculties (id, code, title) values (${id}, ${`PICKUP-${id}`}, ${`Тестовый факультет · ${id}`})`;
      await tx`update students set faculty_id = ${ownFacultyId} where id = any(${[f.anna.studentId, another.actor.studentId]}::uuid[])`;
      await tx`update students set faculty_id = ${foreignFacultyId} where id = ${f.timur.studentId}`;
      await tx`update staff_faculties set faculty_id = ${ownFacultyId} where staff_id = ${f.limited.staffId}`;
    });
    facultyIds.push(ownFacultyId, foreignFacultyId);
    f.anna.facultyId = ownFacultyId;
    another.actor.facultyId = ownFacultyId;
    f.timur.facultyId = foreignFacultyId;
    f.limited.facultyIds = [ownFacultyId];
    const pickup = new PostgresPickupRepository(() => f.sql);
    const requestUow = new DrizzleRequestsUnitOfWork(() => f.sql, f.ids);
    const limiter = new PostgresRateLimiter(() => f.sql, f.clock, f.ids);
    const requests = new DrizzleRequestRepository(() =>
      drizzle(f.sql, { schema }),
    );
    const windowId = f.ids.next(),
      foreignWindowId = f.ids.next();
    for (const [id, facultyId, title] of [
      [
        windowId,
        f.anna.facultyId,
        options.windowTitle ?? `Окно 2 · ${f.marker}`,
      ],
      [foreignWindowId, f.timur.facultyId, `Окно 4 · ${foreignMarker}`],
    ]) {
      if (!id || !facultyId || !title) throw new Error("Нет данных окна");
      await f.sql`insert into pickup_windows (id, faculty_id, title, opens_at, closes_at)
        values (${id}, ${facultyId}, ${title}, '09:00', '17:00')`;
      windows.push(id);
    }
    return {
      ...f,
      marker,
      second: another.actor,
      secondCredentials: another.credentials,
      pickup,
      limiter,
      ownFacultyId,
      foreignFacultyId,
      foreignMarker,
      requestUow,
      windowId,
      foreignWindowId,
      book: new BookRequestPickup(requestUow, f.clock, f.ids, limiter),
      cancel: new CancelRequestPickup(requestUow, f.clock, limiter),
      getPickup: new GetRequestPickup(requests, pickup, f.clock),
      listPickup: new ListStaffPickup(pickup, f.clock),
      changePickup: new ChangeStaffPickup(f.uow, f.clock, f.ids, f.logger),
      async ready(owner: Actor = f.anna) {
        if (owner.kind !== "student") throw new Error("Нужен студент");
        const id = f.ids.next();
        await f.sql`insert into requests (id, public_no, student_id, type_code, payload, status, submitted_at, created_at, updated_at)
          values (${id}, ${`ОЧ-${id.slice(-12)}`}, ${owner.studentId}, 'enrollment_paper', ${f.sql.json({ destination: owner.facultyId === foreignFacultyId ? foreignMarker : marker })}, 'ready', ${f.clock.now().toISOString()}::timestamptz, ${f.clock.now().toISOString()}::timestamptz, ${f.clock.now().toISOString()}::timestamptz)`;
        return id;
      },
      // The browser chooses a future slot; this fixture makes the same ticket visible today at any wall-clock time.
      async bringToToday(
        id: string,
        slotStartsAt = `${pickupToday()}T09:00:00+03:00`,
      ) {
        await f.sql`update pickup_bookings set slot_starts_at = ${slotStartsAt}::timestamptz where id = ${id}`;
      },
      async close() {
        try {
          await f.sql`delete from pickup_bookings where window_id = any(${windows}::uuid[])`;
          await f.sql`delete from pickup_windows where id = any(${windows}::uuid[])`;
          await f.sql`delete from login_attempts where key = any(${[f.anna.userId, f.timur.userId, another.actor.userId].map((id) => `pickup-change:${id}`)}::text[])`;
          await another.close();
        } finally {
          try {
            await f.close();
          } finally {
            await deleteFaculties();
          }
        }
      },
    };
  } catch (error) {
    try {
      if (windows.length) {
        await f.sql`delete from pickup_bookings where window_id = any(${windows}::uuid[])`;
        await f.sql`delete from pickup_windows where id = any(${windows}::uuid[])`;
      }
      await second?.close();
    } finally {
      try {
        await f.close();
      } finally {
        await deleteFaculties();
      }
    }
    throw error;
  }
}
export type PickupFixture = Awaited<ReturnType<typeof openPickupFixture>>;
