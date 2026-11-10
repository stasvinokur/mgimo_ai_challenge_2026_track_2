import { expect, it, vi } from "vitest";
import type { LogContext } from "@/application/ports/logger";
import { SystemClock } from "@/infrastructure/system/clock";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { createPinoLogger } from "@/infrastructure/system/logger";

it("системные часы возвращают текущее время", () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-11-04T10:00:00Z"));
    expect(new SystemClock().now().toISOString()).toBe(
      "2026-11-04T10:00:00.000Z",
    );
  } finally {
    vi.useRealTimers();
  }
});

it("системный генератор выдаёт уникальные uuid v7 с текущим timestamp", () => {
  const ids = new UuidV7Generator();
  const before = Date.now();
  const values = Array.from({ length: 100 }, () => ids.next());
  expect(new Set(values).size).toBe(100);
  for (const value of values) {
    expect(value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const timestamp = Number.parseInt(
      value.replaceAll("-", "").slice(0, 12),
      16,
    );
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(Date.now());
  }
});

it("pino сохраняет только разрешённые метаданные без секретов и ПДн", () => {
  let output = "";
  const logger = createPinoLogger({
    write: (line) => {
      output += line;
    },
  });
  const context = {
    user_id: "00000000-0000-7000-8000-000000000001",
    code: "INTERNAL_ERROR",
    status: 500,
    duration_ms: 25,
    password: "test-password",
    token: "test-token",
    cookie: "test-cookie",
    authorization: "test-authorization",
    apiKey: "test-api-key",
    private_key: "test-private-key",
    KEY: "test-upper-key",
    fullName: "Вымышленное имя",
    email: "fiction@example.invalid",
    nested: { apiKey: "test-nested-key", password: "test-nested-password" },
    err: new Error("test-error-with-personal-data"),
  } as LogContext;
  for (const level of ["info", "warn", "error"] as const)
    logger[level]("test_event", context);
  const rows = output
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(rows).toHaveLength(3);
  for (const row of rows) {
    expect(row).toMatchObject({
      user_id: context.user_id,
      code: "INTERNAL_ERROR",
      status: 500,
      duration_ms: 25,
      msg: "test_event",
    });
    expect(Object.keys(row).sort()).toEqual([
      "code",
      "duration_ms",
      "level",
      "msg",
      "status",
      "time",
      "user_id",
    ]);
  }
  expect(output).not.toContain("test-password");
  expect(output).not.toContain("test-nested");
  expect(output).not.toContain("example.invalid");
});

it("логгер не пишет свободный текст события и невалидные метаданные", () => {
  let output = "";
  const logger = createPinoLogger({
    write: (line) => {
      output += line;
    },
  });
  logger.error("Ошибка с test-secret", {
    user_id: "Вымышленное имя",
    code: "test-secret",
    status: Number.NaN,
  });
  expect(JSON.parse(output)).toMatchObject({ msg: "invalid_event" });
  expect(output).not.toContain("test-secret");
  expect(output).not.toContain("Вымышленное");
});
