import { expect, test } from "@playwright/test";
import { checkAttendanceHttp } from "../integration/attendance-http";

test("посещаемость: production Origin, роли, IDOR, RSC, GET без записи, чужая группа, срок, повтор и закрытие", async ({
  baseURL,
}) => {
  test.skip(!process.env.DATABASE_URL, "Нужна БД тестового лейна.");
  if (!baseURL) throw new Error("Не указан адрес приложения.");
  const result = await checkAttendanceHttp(baseURL);
  expect(result.checks).toBeGreaterThanOrEqual(30);
});
