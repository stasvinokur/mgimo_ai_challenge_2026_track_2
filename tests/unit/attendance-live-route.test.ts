import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/(teacher)/teacher/attendance/[slotId]/[date]/live/route";
import { ForbiddenError } from "@/application/shared/errors";

const state = vi.hoisted(() => ({
  kind: "teacher",
  issue: vi.fn(),
  close: vi.fn(),
  origin: vi.fn(),
  ip: vi.fn(() => "normalized-ip"),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "a".repeat(43) }) }),
}));
vi.mock("@/app/attend/origin", () => ({
  requireAttendanceOrigin: state.origin,
}));
vi.mock("@/composition/container", () => ({
  identity: {
    sessionCookie: { name: "__Host-pulse-session" },
    getCurrentActor: {
      execute: async () => ({
        actor:
          state.kind === "teacher"
            ? { kind: "teacher", userId: "teacher-user", teacherId: "teacher" }
            : {
                kind: "student",
                userId: "student-user",
                studentId: "student",
                facultyId: "fmo",
              },
      }),
    },
    getClientIp: state.ip,
  },
  attendance: {
    issueCode: { execute: state.issue },
    closeAttendance: { execute: state.close },
  },
  system: { logger: { error: vi.fn() } },
}));
const context = {
  params: Promise.resolve({ slotId: "lesson", date: "2026-11-05" }),
};
const request = (body: unknown) =>
  new Request("https://pulse.example/teacher/attendance/lesson/date/live", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": "untrusted, trusted",
    },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  state.kind = "teacher";
  state.origin.mockReset();
  state.issue.mockReset();
  state.close.mockReset();
  state.ip.mockClear();
  state.issue.mockResolvedValue({ path: "/attend/code" });
  state.close.mockResolvedValue({ closed: true });
  vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "true");
});
it("студент не вызывает POST /live: 403 до чтения тела, Origin и use case", async () => {
  state.kind = "student";
  const input = request({ action: "close" });
  await expect(POST(input, context)).rejects.toMatchObject({
    digest: "NEXT_HTTP_ERROR_FALLBACK;403",
  });
  expect(input.bodyUsed).toBe(false);
  expect(state.origin).not.toHaveBeenCalled();
  expect(state.issue).not.toHaveBeenCalled();
  expect(state.close).not.toHaveBeenCalled();
});
it("Origin проверяется до чтения тела", async () => {
  state.origin.mockRejectedValue(new ForbiddenError());
  const input = request({ action: "issue" });
  expect((await POST(input, context)).status).toBe(403);
  expect(input.bodyUsed).toBe(false);
  expect(state.issue).not.toHaveBeenCalled();
});
it("POST передаёт только серверный нормализованный IP и ключ занятия из маршрута", async () => {
  expect(
    (
      await POST(
        request({ action: "issue", previousCode: "previous" }),
        context,
      )
    ).status,
  ).toBe(200);
  expect(state.ip).toHaveBeenCalledWith("untrusted, trusted");
  expect(state.issue).toHaveBeenCalledWith(
    { kind: "teacher", userId: "teacher-user", teacherId: "teacher" },
    {
      lesson: { slotId: "lesson", occurrenceDate: "2026-11-05" },
      previousCode: "previous",
      ip: "normalized-ip",
    },
  );
  expect((await POST(request({ action: "close" }), context)).status).toBe(200);
  expect(state.close).toHaveBeenCalledWith(
    { kind: "teacher", userId: "teacher-user", teacherId: "teacher" },
    { slotId: "lesson", occurrenceDate: "2026-11-05", ip: "normalized-ip" },
  );
});
it.each([
  { action: "issue", ip: "attacker" },
  { action: "close", ip: "attacker" },
  { action: "issue", lesson: {} },
  { action: "close", studentId: "foreign" },
])("POST отклоняет серверные и чужие поля клиента", async (body) => {
  expect((await POST(request(body), context)).status).toBe(400);
  expect(state.issue).not.toHaveBeenCalled();
  expect(state.close).not.toHaveBeenCalled();
});
it("неправильный JSON не превращается в 500", async () => {
  const input = new Request(
    "https://pulse.example/teacher/attendance/lesson/date/live",
    { method: "POST", body: "{" },
  );
  const response = await POST(input, context);
  expect(response.status).toBe(400);
  expect(state.issue).not.toHaveBeenCalled();
});
