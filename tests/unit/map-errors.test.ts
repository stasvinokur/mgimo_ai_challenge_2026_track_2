import { describe, expect, it, vi } from "vitest";
import {
  mapActionError,
  mapPageError,
  mapRouteError,
} from "@/app/_lib/map-errors";
import type { Logger } from "@/application/ports/logger";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from "@/application/shared/errors";

vi.mock("server-only", () => ({}));

function logger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const cases = [
  { error: new NotFoundError(), status: 404, code: "NOT_FOUND" },
  { error: new ForbiddenError(), status: 403, code: "FORBIDDEN" },
  {
    error: new ValidationError({ title: ["Заполните поле."] }),
    status: 400,
    code: "VALIDATION",
  },
  { error: new ConflictError(), status: 409, code: "CONFLICT" },
  { error: new RateLimitedError(), status: 429, code: "RATE_LIMITED" },
];

describe.each(cases)("маппинг $code", ({ error, status, code }) => {
  it("Route Handler возвращает HTTP-код и безопасный JSON", async () => {
    const log = logger();
    const response = mapRouteError(error, log);
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json();
    expect(body.error).toMatchObject({ code, message: error.message });
    expect(log.error).not.toHaveBeenCalled();
  });

  it("Server Action возвращает сериализуемый результат", () => {
    const result = mapActionError(error, logger());
    expect(result).toMatchObject({
      ok: false,
      status,
      error: { code, message: error.message },
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    if (error instanceof ValidationError) {
      expect(result.error.fieldErrors).toEqual(error.fieldErrors);
    }
  });
});

it.each([
  new Error("Закрытые данные: test-token"),
  { password: "test-password" },
  null,
  "test-cookie",
])("неизвестная ошибка скрывает детали в ответе и в логе", async (error) => {
  const log = logger();
  const response = mapRouteError(error, log);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: {
      code: "INTERNAL_ERROR",
      message: "Не удалось выполнить действие. Попробуйте снова.",
    },
  });
  expect(log.error).toHaveBeenCalledExactlyOnceWith("unexpected_error", {
    code: "INTERNAL_ERROR",
  });
  expect(JSON.stringify(vi.mocked(log.error).mock.calls)).not.toContain(
    "test-",
  );
  expect(mapActionError(error, logger()).status).toBe(500);
  expect(() => mapPageError(error, logger())).toThrow(
    "Не удалось выполнить действие. Попробуйте снова.",
  );
});

it.each([
  { error: new NotFoundError(), digest: "NEXT_HTTP_ERROR_FALLBACK;404" },
  { error: new ForbiddenError(), digest: "NEXT_HTTP_ERROR_FALLBACK;403" },
])(
  "страницы используют настоящий Next interrupt $digest",
  ({ error, digest }) => {
    vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "true");
    expect(() => mapPageError(error, logger())).toThrow(
      expect.objectContaining({ digest }),
    );
  },
);

it.each([
  new ValidationError({ title: ["Заполните поле."] }),
  new ConflictError(),
  new RateLimitedError(),
])("страница передаёт безопасную ошибку в error boundary: $name", (error) => {
  expect(() => mapPageError(error, logger())).toThrow(error.message);
});
