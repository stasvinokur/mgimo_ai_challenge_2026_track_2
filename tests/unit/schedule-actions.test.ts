import { beforeEach, expect, it, vi } from "vitest";
import { renewCalendar } from "@/app/(student)/schedule/actions";

const mocks = vi.hoisted(() => ({
  requireStudent: vi.fn(),
  execute: vi.fn(),
  mapActionError: vi.fn(),
}));
vi.mock("@/app/_lib/get-actor", () => ({
  requireStudent: mocks.requireStudent,
}));
vi.mock("@/composition/container", () => ({
  schedule: { renewCalendarToken: { execute: mocks.execute } },
}));
vi.mock("@/app/_lib/map-errors", () => ({
  mapActionError: mocks.mapActionError,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireStudent.mockResolvedValue({
    kind: "student",
    userId: "anna-user",
    studentId: "anna",
    facultyId: "fmo",
  });
});

it.each([
  "NOT_FOUND",
  "FORBIDDEN",
  "VALIDATION",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
] as const)(
  "ошибка подписки %s возвращает только закрытый код без фразы",
  async (code) => {
    mocks.execute.mockRejectedValue(new Error("raw details"));
    mocks.mapActionError.mockReturnValue({
      ok: false,
      status: 400,
      error: {
        code,
        message: "Непереведённая фраза",
        fieldErrors: { key: ["raw"] },
      },
    });
    expect(await renewCalendar(null, new FormData())).toEqual({
      ok: false,
      status: 400,
      error: { code },
    });
  },
);

it("неизвестный код закрывается общим кодом, успешный ответ сохраняет только путь", async () => {
  mocks.execute.mockRejectedValueOnce(new Error("raw details"));
  mocks.mapActionError.mockReturnValue({
    ok: false,
    status: 500,
    error: { code: "UNEXPECTED_NEW_CODE", message: "raw details" },
  });
  expect(await renewCalendar(null, new FormData())).toEqual({
    ok: false,
    status: 500,
    error: { code: "INTERNAL_ERROR" },
  });
  mocks.execute.mockResolvedValue({ path: "/api/calendar/token" });
  expect(await renewCalendar(null, new FormData())).toEqual({
    ok: true,
    path: "/api/calendar/token",
  });
});

it("guard выполняется в action до обращения к токенам", async () => {
  const failure = new Error("forbidden");
  mocks.requireStudent.mockRejectedValue(failure);
  await expect(renewCalendar(null, new FormData())).rejects.toBe(failure);
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(mocks.mapActionError).not.toHaveBeenCalled();
});
