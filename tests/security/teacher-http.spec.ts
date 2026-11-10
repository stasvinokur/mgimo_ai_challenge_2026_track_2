import { expect, test } from "@playwright/test";
import { checkTeacherHttp } from "../integration/teacher-http";

test("HTTP и RSC: матрица трёх ролей, аноним, API ассистента, PDF, ICS и пульса", async ({
  baseURL,
}) => {
  test.skip(!process.env.DATABASE_URL, "Нужна БД тестового лейна.");
  if (!baseURL) throw new Error("Укажите адрес приложения.");
  expect(await checkTeacherHttp(baseURL)).toEqual({ checks: 40 });
});
