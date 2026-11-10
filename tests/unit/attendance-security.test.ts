import { existsSync, readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import { markAttendance } from "@/app/attend/actions";
import { attendanceOrigin } from "@/application/attendance/origin";
import { loginDestination } from "@/application/identity/schemas";
import { proxy } from "@/proxy";

const spies = vi.hoisted(() => ({
  mark: vi.fn(),
  ip: vi.fn(() => "192.0.2.35"),
  headers: new Headers(),
  guard: vi.fn(async () => ({
    kind: "student",
    userId: "test",
    studentId: "student",
    facultyId: "fmo",
  })),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => spies.headers }));
vi.mock("@/app/_lib/get-actor", () => ({ requireStudent: spies.guard }));
vi.mock("@/composition/container", () => ({
  identity: {
    getClientIp: spies.ip,
    sessionCookie: { name: "__Host-pulse-session" },
    getCurrentActor: { execute: async () => null },
  },
  attendance: { markAttendance: { execute: spies.mark } },
  system: { getEnv: () => "https://pulse.example", logger: { error: vi.fn() } },
}));
beforeEach(() => {
  spies.headers = new Headers({
    host: "pulse.example",
    "x-forwarded-proto": "https",
  });
  spies.mark.mockReset();
  spies.guard.mockClear();
});
it("proxy защищает /attend; loginDestination студента возвращает по QR без внешнего редиректа", async () => {
  const path = `/attend/${"a".repeat(22)}`;
  const response = await proxy(new NextRequest(`https://pulse.example${path}`));
  expect(response.status).toBe(307);
  const location = new URL(response.headers.get("location") ?? "");
  expect(location.pathname).toBe("/login");
  expect(location.searchParams.get("next")).toBe(path);
  expect(loginDestination("student", path)).toBe(path);
  expect(loginDestination("staff", path)).toBe("/staff/requests");
  expect(loginDestination("teacher", path)).toBe("/teacher");
  expect(loginDestination("student", `//foreign.example${path}`)).toBe(
    "/today",
  );
  expect(loginDestination("student", `/attend%2f${"a".repeat(22)}`)).toBe(
    "/today",
  );
});
it.each([undefined, "null", "https://foreign.example", "http://pulse.example"])(
  "Server Action без доверенного Origin (%s) не вызывает use case",
  async (origin) => {
    if (origin) spies.headers.set("origin", origin);
    const result = await markAttendance("a".repeat(22), null, new FormData());
    expect(result).toMatchObject({
      result: "error",
      messageCode: "forbidden",
    });
    expect(spies.guard).toHaveBeenCalledTimes(1);
    expect(spies.mark).not.toHaveBeenCalled();
  },
);
it("Server Action с правильным Origin вызывает use case со студентом из guard", async () => {
  spies.headers.set("origin", "https://pulse.example");
  spies.mark.mockResolvedValue({
    result: "marked",
    messageCode: "marked",
    points: 1,
  });
  await markAttendance("a".repeat(22), null, new FormData());
  expect(spies.mark).toHaveBeenCalledWith(await spies.guard(), {
    code: "a".repeat(22),
    ip: "192.0.2.35",
  });
});
it("у /attend/[code] и teacher/[slotId]/[date] нет loading, страницы и обработчики сами проверяют роль", () => {
  for (const path of [
    "src/app",
    "src/app/attend",
    "src/app/attend/[code]",
    "src/app/(teacher)",
    "src/app/(teacher)/teacher",
    "src/app/(teacher)/teacher/attendance",
    "src/app/(teacher)/teacher/attendance/[slotId]",
    "src/app/(teacher)/teacher/attendance/[slotId]/[date]",
  ]) {
    for (const extension of ["ts", "tsx", "js", "jsx"])
      expect(existsSync(`${path}/loading.${extension}`)).toBe(false);
  }
  expect(readFileSync("src/app/attend/[code]/page.tsx", "utf8")).toContain(
    "await requireStudent()",
  );
  expect(readFileSync("src/app/attend/page.tsx", "utf8")).toContain(
    "await requireStudent()",
  );
});

it("Origin за standalone/proxy определяется по Host, а APP_ORIGIN имеет приоритет", () => {
  const headers = new Headers({
    host: "127.0.0.1:3135",
    "x-forwarded-host": "pulse.example",
    "x-forwarded-proto": "https",
  });
  expect(attendanceOrigin(headers)).toBe("https://pulse.example");
  expect(attendanceOrigin(headers, "https://configured.example")).toBe(
    "https://configured.example",
  );
  expect(() => attendanceOrigin(new Headers({ host: "bad/host" }))).toThrow();
});

it("Server Action не принимает ip из формы", async () => {
  spies.headers.set("origin", "https://pulse.example");
  spies.headers.set("x-forwarded-for", "192.0.2.35");
  const form = new FormData();
  form.set("ip", "198.51.100.35");
  expect(await markAttendance("a".repeat(22), null, form)).toMatchObject({
    result: "invalid",
  });
  expect(spies.mark).not.toHaveBeenCalled();
});
