import { expect, it } from "vitest";
import { createDatabase } from "@/infrastructure/db/client";
import { readDemoAccountCounts } from "./demo-account-counts";
import { openStaffFixture, type StaffFixture } from "./staff-fixtures";

it("staff-фикстура изолирует заявки и уведомления от демо-аккаунтов и удаляет временных студентов", async () => {
  const sql = createDatabase(1);
  let fixture: StaffFixture | undefined;
  try {
    const before = await readDemoAccountCounts(sql);
    expect(before.map((row) => row.login)).toEqual(["anna", "marina", "timur"]);
    fixture = await openStaffFixture();
    const f = fixture;
    const userIds = [f.anna.userId, f.timur.userId, f.limited.userId];
    const studentIds = [f.anna.studentId, f.timur.studentId];
    const requests = [await f.request(), await f.request(f.timur)];
    for (const [index, id] of requests.entries()) {
      expect(
        await sql`select student_id from requests where id = ${id}`,
      ).toMatchObject([{ student_id: studentIds[index] }]);
      for (const to of ["accepted", "in_progress", "ready"])
        await f.change.execute(f.marina, { id, to });
      expect(
        await sql`select distinct user_id from notifications where link = ${`/requests/${id}`}`,
      ).toMatchObject([{ user_id: userIds[index] }]);
    }
    await f.session(f.anna);
    await f.session(f.timur);
    expect(await readDemoAccountCounts(sql)).toEqual(before);
    await f.close();
    fixture = undefined;
    for (const table of ["users", "sessions", "notifications"] as const) {
      const column = table === "users" ? "id" : "user_id";
      expect(
        await sql`select count(*)::int as n from ${sql(table)} where ${sql(column)} = any(${userIds}::uuid[])`,
      ).toEqual([{ n: 0 }]);
    }
    expect(
      await sql`select id from students where id = any(${studentIds}::uuid[])`,
    ).toHaveLength(0);
    expect(
      await sql`select id from requests where student_id = any(${studentIds}::uuid[])`,
    ).toHaveLength(0);
    expect(await readDemoAccountCounts(sql)).toEqual(before);
  } finally {
    try {
      await fixture?.close();
    } finally {
      await sql.end({ timeout: 1 });
    }
  }
});
