import { drizzle } from "drizzle-orm/postgres-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDatabase,
  getDatabaseUrl,
  normalizeDatabaseValue,
} from "../../src/infrastructure/db/client";

afterEach(() => vi.unstubAllEnvs());

describe("Окружение БД проверяется при обращении", () => {
  it("импорт клиента не требует DATABASE_URL", async () => {
    vi.stubEnv("DATABASE_URL", undefined);
    await expect(
      import("../../src/infrastructure/db/client"),
    ).resolves.toBeDefined();
    expect(() => createDatabase()).toThrow("Задайте корректный DATABASE_URL");
  });

  it.each([undefined, "", "https://example.invalid/pulse", "postgres://"])(
    "отклоняет неподходящую строку подключения без раскрытия её значения",
    (value) => {
      vi.stubEnv("DATABASE_URL", value);
      expect(() => getDatabaseUrl()).toThrow(
        "Задайте корректный DATABASE_URL для PostgreSQL.",
      );
    },
  );

  it.each(["postgres", "postgresql"])("принимает протокол %s", (protocol) => {
    const url = `${protocol}://test:test@127.0.0.1:5432/pulse_test`;
    vi.stubEnv("DATABASE_URL", url);
    expect(getDatabaseUrl()).toBe(url);
  });
});

describe("Нормализация timestamptz на границе БД", () => {
  it.each([
    "2026-11-04 12:00:00+03",
    "2026-11-04T09:00:00.000Z",
    new Date("2026-11-04T09:00:00.000Z"),
  ])("декодирует дату %s в один момент UTC", (value) => {
    expect(normalizeDatabaseValue(value, { type: 1184 })).toEqual(
      new Date("2026-11-04T09:00:00.000Z"),
    );
  });

  it("сохраняет null и значения других типов PostgreSQL", () => {
    for (const value of [null, "2026-11-04", 42, { due: "2026-11-04" }]) {
      expect(normalizeDatabaseValue(value, { type: 25 })).toBe(value);
    }
    expect(normalizeDatabaseValue(null, { type: 1184 })).toBeNull();
  });

  it.each(["не дата", new Date(Number.NaN), 123])(
    "отклоняет некорректную дату без вывода значения",
    (value) => {
      expect(() => normalizeDatabaseValue(value, { type: 1184 })).toThrow(
        "Некорректная временная метка БД.",
      );
    },
  );

  it("Drizzle не отключает нормализацию клиента", async () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://test:test@127.0.0.1:5432/pulse_test",
    );
    const sql = createDatabase(1);
    try {
      const normalize = sql.options.transform.value.from;
      expect(normalize).toBe(normalizeDatabaseValue);
      drizzle(sql);
      expect(sql.options.transform.value.from).toBe(normalize);
      expect(
        normalizeDatabaseValue(
          sql.options.parsers[1184]?.("2026-11-04 12:00:00+03"),
          { type: 1184 },
        ),
      ).toEqual(new Date("2026-11-04T09:00:00.000Z"));
    } finally {
      await sql.end({ timeout: 1 });
    }
  });
});
