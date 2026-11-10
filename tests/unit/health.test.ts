import { beforeEach, expect, it, vi } from "vitest";
import { getDatabase } from "../../src/infrastructure/db/client";
import { isDatabaseAvailable } from "../../src/infrastructure/db/health";

vi.mock("../../src/infrastructure/db/client", () => ({ getDatabase: vi.fn() }));

beforeEach(() => {
  vi.mocked(getDatabase).mockReset();
});

it("проверяет доступность запросом к БД", async () => {
  const sql = vi.fn().mockResolvedValue([{ value: 1 }]);
  vi.mocked(getDatabase).mockReturnValue(
    sql as unknown as ReturnType<typeof getDatabase>,
  );
  expect(await isDatabaseAvailable()).toBe(true);
  expect(sql).toHaveBeenCalledOnce();
});

it("возвращает недоступность при отказе запроса", async () => {
  const sql = vi.fn().mockRejectedValue(new Error("Отказ БД"));
  vi.mocked(getDatabase).mockReturnValue(
    sql as unknown as ReturnType<typeof getDatabase>,
  );
  expect(await isDatabaseAvailable()).toBe(false);
});

it("возвращает недоступность при ошибке окружения", async () => {
  vi.mocked(getDatabase).mockImplementation(() => {
    throw new Error("Нет окружения");
  });
  expect(await isDatabaseAvailable()).toBe(false);
});
