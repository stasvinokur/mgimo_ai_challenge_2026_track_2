import { test as base, expect } from "@playwright/test";
import { createDatabase } from "@/infrastructure/db/client";
import {
  openStaffFixture,
  type StaffFixture,
} from "../integration/staff-fixtures";
import {
  openStudentTestData,
  type StudentTestData,
} from "../integration/student-e2e-data";
import { loginAsTestStudent } from "./student-login";

export const test = base.extend<{
  assistantStudent: StudentTestData & {
    sql: ReturnType<typeof createDatabase>;
  };
  otherStudent: StudentTestData;
  loginStudent: () => Promise<void>;
  assistantStaff: StaffFixture;
}>({
  assistantStaff: async ({ baseURL }, use) => {
    if (!baseURL) throw new Error("Нужен адрес приложения.");
    base.skip(!process.env.DATABASE_URL, "Нужна БД лейна.");
    const data = await openStaffFixture();
    try {
      await use(data);
    } finally {
      await data.close();
    }
  },
  assistantStudent: async ({ baseURL }, use) => {
    if (!baseURL) throw new Error("Нужен адрес приложения.");
    base.skip(!process.env.DATABASE_URL, "Нужна БД лейна.");
    const data = await openStudentTestData("anna");
    const sql = createDatabase(1);
    try {
      await use({ ...data, sql });
    } finally {
      await sql`delete from assistant_log where user_id = ${data.actor.userId}`;
      await sql.end({ timeout: 1 });
      await data.close();
    }
  },
  otherStudent: async ({ baseURL }, use) => {
    if (!baseURL) throw new Error("Нужен адрес приложения.");
    base.skip(!process.env.DATABASE_URL, "Нужна БД лейна.");
    const data = await openStudentTestData("timur");
    try {
      await use(data);
    } finally {
      const sql = createDatabase(1);
      await sql`delete from assistant_log where user_id = ${data.actor.userId}`;
      await sql.end({ timeout: 1 });
      await data.close();
    }
  },
  loginStudent: async ({ page, assistantStudent }, use) => {
    await use(() => loginAsTestStudent(page, assistantStudent.credentials));
  },
});
export { expect };
