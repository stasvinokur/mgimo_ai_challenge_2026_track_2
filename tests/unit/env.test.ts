import { expect, it, vi } from "vitest";
import { envSchema, getEnv } from "@/infrastructure/config/env";

it("импорт не читает env, первая попытка прочитать обязательную настройку выдаёт безопасную ошибку", async () => {
  vi.stubEnv("DATABASE_URL", undefined);
  vi.stubEnv("OLLAMA_API_KEY", undefined);
  await expect(import("@/infrastructure/config/env")).resolves.toBeDefined();
  expect(() => getEnv("DATABASE_URL")).toThrow(
    "Проверьте переменную окружения DATABASE_URL.",
  );
  expect(() => getEnv("OLLAMA_API_KEY")).toThrow(
    "Проверьте переменную окружения OLLAMA_API_KEY.",
  );
  expect(getEnv("TZ")).toBe("Europe/Moscow");
});

it("независимые настройки читаются без ключа модели, значения не попадают в ошибку", () => {
  vi.stubEnv("OLLAMA_API_KEY", undefined);
  vi.stubEnv("APP_VERSION", "test-image-tag");
  expect(getEnv("APP_VERSION")).toBe("test-image-tag");
  vi.stubEnv("DATABASE_URL", "https://test:test-private@example.invalid/db");
  try {
    getEnv("DATABASE_URL");
    expect.unreachable();
  } catch (error) {
    expect(String(error)).not.toContain("test-private");
    expect(String(error)).not.toContain("example.invalid");
  }
});

it("схема описывает переменные doc-1 и принимает вымышленное окружение", () => {
  const environment = {
    DATABASE_URL: "postgresql://test:test@localhost:5432/pulse_test",
    POSTGRES_PASSWORD: "test-password",
    APP_DOMAIN: "example.invalid",
    APP_ORIGIN: "https://example.invalid",
    IMAGE_TAG: "test-tag",
    COMPOSE_FILE: "compose.yaml:compose.server.yaml",
    OLLAMA_HOST: "https://example.invalid",
    OLLAMA_API_KEY: "test-key",
    OLLAMA_MODEL: "test-model",
    OLLAMA_FALLBACK_MODEL: "test-fallback",
    ICS_TOKEN_SECRET: "test-ics-secret-000000000000000000",
  };
  expect(envSchema.parse(environment)).toEqual({
    ...environment,
    DEMO_LOGIN_HINTS: "on",
    TZ: "Europe/Moscow",
  });
});

it.each([
  ["DATABASE_URL", "https://example.invalid"],
  ["APP_ORIGIN", "file:///tmp/example"],
  ["APP_DOMAIN", "https://example.invalid"],
  ["OLLAMA_HOST", "file:///tmp/example"],
  ["ICS_TOKEN_SECRET", "short"],
  ["TZ", "UTC"],
  ["APP_VERSION", ""],
] as const)("отклоняет неправильную настройку %s", (key, value) => {
  vi.stubEnv(key, value);
  expect(() => getEnv(key)).toThrow(`Проверьте переменную окружения ${key}.`);
});

it.each(["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const)(
  "%s необязательна, пустая настройка compose означает отсутствие",
  (key) => {
    vi.stubEnv(key, undefined);
    expect(getEnv(key)).toBeUndefined();
    vi.stubEnv(key, "");
    expect(getEnv(key)).toBeUndefined();
    vi.stubEnv(key, "test-setting");
    expect(getEnv(key)).toBe("test-setting");
    vi.stubEnv("DATABASE_URL", undefined);
    vi.stubEnv("OLLAMA_API_KEY", undefined);
    expect(getEnv(key)).toBe("test-setting");
  },
);
