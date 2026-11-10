import { beforeEach, expect, it, vi } from "vitest";
import { NotFoundError } from "@/application/shared/errors";

const { execute, getActor } = vi.hoisted(() => ({
  execute: vi.fn(),
  getActor: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/composition/container", () => ({
  schedule: { getCalendar: { execute } },
  system: { logger: { error: vi.fn() } },
}));
vi.mock("@/app/_lib/get-actor", () => ({ getActor }));

import { GET } from "@/app/api/calendar/[token]/route";

beforeEach(() => {
  execute.mockReset();
  getActor.mockReset();
});

it("ICS доступен без cookie, отдаёт private/no-store и MIME календаря", async () => {
  getActor.mockResolvedValue(null);
  execute.mockResolvedValue("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
  const response = await GET(
    new Request("https://pulse.test/api/calendar/test"),
    { params: Promise.resolve({ token: "test" }) },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-type")).toBe(
    "text/calendar; charset=utf-8",
  );
  expect(execute).toHaveBeenCalledWith("test", null);
});

it("передаёт Actor из сессии; неизвестный/старый/чужой токен получают одинаковый 404", async () => {
  const actor = { kind: "student", studentId: "anna" };
  getActor.mockResolvedValue(actor);
  execute.mockRejectedValue(new NotFoundError());
  const response = await GET(
    new Request("https://pulse.test/api/calendar/foreign"),
    { params: Promise.resolve({ token: "foreign" }) },
  );
  expect(execute).toHaveBeenCalledWith("foreign", actor);
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({
    error: { code: "NOT_FOUND", message: "Объект не найден." },
  });
});

it("query не может заменить владельца или токен", async () => {
  const response = await GET(
    new Request("https://pulse.test/api/calendar/test?studentId=other"),
    { params: Promise.resolve({ token: "test" }) },
  );
  expect(response.status).toBe(404);
  expect(execute).not.toHaveBeenCalled();
});
