import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "@/app/api/me/pulse/route";
import { anna, marina, timur } from "../fakes/identity";

const mocks = vi.hoisted(() => ({ getActor: vi.fn(), execute: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/app/_lib/get-actor", () => ({ getActor: mocks.getActor }));
vi.mock("@/composition/container", () => ({
  notifications: { getMyPulse: { execute: mocks.execute } },
  system: { logger: { error: vi.fn() } },
}));
beforeEach(() => {
  mocks.getActor.mockReset();
  mocks.execute.mockReset();
});

it("аноним получает 401 JSON без редиректа; сотрудник 403 без данных", async () => {
  for (const [actor, status] of [
    [null, 401],
    [marina, 403],
  ] as const) {
    mocks.getActor.mockResolvedValue(actor);
    const response = await GET();
    expect(response.status).toBe(status);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Location")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toHaveProperty("error");
  }
  expect(mocks.execute).not.toHaveBeenCalled();
});

it.each([anna, timur])(
  "пульс содержит строго unread и ISO latestAt, Actor только из сессии $userId",
  async (actor) => {
    mocks.getActor.mockResolvedValue(actor);
    const pulse = { unread: 3, latestAt: "2026-11-04T09:00:00.000Z" };
    mocks.execute.mockResolvedValue(pulse);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual(pulse);
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(actor);
  },
);

it("ошибка БД не раскрывает детали и не кешируется", async () => {
  mocks.getActor.mockResolvedValue(anna);
  mocks.execute.mockRejectedValue(new Error("Внутренние детали"));
  const response = await GET();
  expect(response.status).toBe(500);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.text()).not.toContain("Внутренние детали");
});
