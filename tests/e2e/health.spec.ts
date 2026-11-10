import { expect, test } from "@playwright/test";

test("health сообщает готовность стека и версию без кеширования", async ({
  request,
}) => {
  test.skip(
    !process.env.PLAYWRIGHT_BASE_URL && !process.env.DATABASE_URL,
    "Нужна БД или готовый стек.",
  );
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(
    response
      .headers()
      ["cache-control"]?.split(",")
      .map((directive) => directive.trim()),
  ).toContain("no-store");
  expect(await response.json()).toEqual({
    status: "ok",
    version: expect.any(String),
  });
});
