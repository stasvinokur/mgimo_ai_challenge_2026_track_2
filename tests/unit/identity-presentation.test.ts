import { existsSync } from "node:fs";
import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import {
  getActor,
  requireStaff,
  requireStudent,
  requireTeacher,
} from "@/app/_lib/get-actor";
import StaffLayout from "@/app/(staff)/layout";
import TeacherLayout from "@/app/(teacher)/layout";
import type { Actor } from "@/application/ports/actor";
import { identity } from "@/composition/container";
import { proxy } from "@/proxy";
import { anna, marina } from "../fakes/identity";

const oleg: Actor = {
  kind: "teacher",
  userId: "oleg-user",
  teacherId: "oleg-teacher",
};

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "a".repeat(43) }) }),
}));
vi.mock("@/composition/container", async () => {
  const { sessionCookieOptions } = await import(
    "@/infrastructure/auth/session-cookie"
  );
  return {
    identity: {
      getCurrentActor: { execute: vi.fn() },
      sessionCookie: {
        name: "__Host-pulse-session",
        options: sessionCookieOptions,
      },
    },
    system: { logger: { error: vi.fn() } },
  };
});
beforeEach(() => {
  vi.mocked(identity.getCurrentActor.execute).mockReset();
});

it("над проверкой layout нет корневой loading-границы, студент получает interrupt 403", async () => {
  for (const extension of ["tsx", "ts", "jsx", "js"]) {
    expect(
      existsSync(
        new URL(`../../src/app/loading.${extension}`, import.meta.url),
      ),
      "Корневой loading начнёт стримить HTTP 200 до проверки роли.",
    ).toBe(false);
  }
  vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "true");
  vi.mocked(identity.getCurrentActor.execute).mockResolvedValue({
    actor: anna,
    expiresAt: "2026-11-11T09:00:00Z",
    renewed: false,
  });
  await expect(
    StaffLayout({ children: "Данные сотрудника" }),
  ).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;403" });
});

it("сервер получает Actor из cookie, а не параметров страницы", async () => {
  vi.mocked(identity.getCurrentActor.execute).mockResolvedValue({
    actor: anna,
    expiresAt: "2026-11-11T09:00:00Z",
    renewed: false,
  });
  expect(await getActor()).toEqual(anna);
  expect(identity.getCurrentActor.execute).toHaveBeenCalledWith("a".repeat(43));
  expect(await requireStudent()).toEqual(anna);
  vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "true");
  await expect(requireStaff()).rejects.toMatchObject({
    digest: "NEXT_HTTP_ERROR_FALLBACK;403",
  });
});

it("без proxy сервер отклоняет недействительную сессию и чужую роль", async () => {
  vi.mocked(identity.getCurrentActor.execute).mockResolvedValue(null);
  await expect(requireStudent()).rejects.toMatchObject({
    digest: expect.stringContaining("/login"),
  });
  await expect(requireStaff()).rejects.toMatchObject({
    digest: expect.stringContaining("/login"),
  });
  vi.mocked(identity.getCurrentActor.execute).mockResolvedValue({
    actor: marina,
    expiresAt: "2026-11-11T09:00:00Z",
    renewed: false,
  });
  await expect(requireStudent()).rejects.toMatchObject({
    digest: expect.stringContaining("/staff/requests"),
  });
});

it("teacher guard: аноним уходит на вход, две чужие роли получают 403, преподаватель допущен", async () => {
  vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "true");
  vi.mocked(identity.getCurrentActor.execute).mockResolvedValue(null);
  await expect(requireTeacher()).rejects.toMatchObject({
    digest: expect.stringContaining("/login"),
  });
  for (const actor of [anna, marina]) {
    vi.mocked(identity.getCurrentActor.execute).mockResolvedValue({
      actor,
      expiresAt: "2026-11-11T09:00:00Z",
      renewed: false,
    });
    await expect(requireTeacher()).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;403",
    });
    await expect(TeacherLayout({ children: "Мои пары" })).rejects.toMatchObject(
      { digest: "NEXT_HTTP_ERROR_FALLBACK;403" },
    );
  }
  vi.mocked(identity.getCurrentActor.execute).mockResolvedValue({
    actor: oleg,
    expiresAt: "2026-11-11T09:00:00Z",
    renewed: false,
  });
  expect(await requireTeacher()).toEqual(oleg);
  await expect(requireStudent()).rejects.toMatchObject({
    digest: expect.stringContaining("/teacher"),
  });
  await expect(requireStaff()).rejects.toMatchObject({
    digest: "NEXT_HTTP_ERROR_FALLBACK;403",
  });
  expect(
    (await proxy(new NextRequest("https://pulse.example/teacher"))).status,
  ).toBe(307);
});

it("proxy выставляет уникальный nonce в CSP и серверный заголовок, анониму сохраняет относительный next", async () => {
  const request = new NextRequest("https://pulse.example/profile?tab=main");
  const response = await proxy(request);
  expect(response.status).toBe(307);
  const url = new URL(response.headers.get("location") ?? "");
  expect(url.pathname).toBe("/login");
  expect(url.searchParams.get("next")).toBe("/profile?tab=main");
  const first = (
    await proxy(
      new NextRequest("https://pulse.example/login", {
        headers: { "x-nonce": "attacker" },
      }),
    )
  ).headers;
  const second = (await proxy(new NextRequest("https://pulse.example/login")))
    .headers;
  expect(first.get("content-security-policy")).not.toContain("unsafe-eval");
  expect(first.get("content-security-policy")).not.toContain("attacker");
  expect(first.get("content-security-policy")).toContain(
    `'nonce-${first.get("x-middleware-request-x-nonce")}'`,
  );
  expect(first.get("content-security-policy")).not.toBe(
    second.get("content-security-policy"),
  );
});

it("proxy продлевает cookie после активности, а подложная cookie не создаёт Actor", async () => {
  vi.mocked(identity.getCurrentActor.execute).mockResolvedValue({
    actor: anna,
    expiresAt: "2026-11-11T09:15:00Z",
    renewed: true,
  });
  const response = await proxy(
    new NextRequest("https://pulse.example/profile", {
      headers: { cookie: `__Host-pulse-session=${"a".repeat(43)}` },
    }),
  );
  expect(response.cookies.get("__Host-pulse-session")).toMatchObject({
    value: "a".repeat(43),
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: new Date("2026-11-11T09:15:00Z"),
  });
  vi.mocked(identity.getCurrentActor.execute).mockResolvedValue(null);
  expect(await getActor()).toBeNull();
});

it("proxy оставляет проверку роли серверу и перенаправляет отозванную сессию", async () => {
  const request = new NextRequest("https://pulse.example/staff/requests", {
    headers: { cookie: `__Host-pulse-session=${"a".repeat(43)}` },
  });
  vi.mocked(identity.getCurrentActor.execute).mockResolvedValue({
    actor: anna,
    expiresAt: "2026-11-11T09:15:00Z",
    renewed: false,
  });
  expect((await proxy(request)).headers.get("x-middleware-next")).toBe("1");
  vi.mocked(identity.getCurrentActor.execute).mockResolvedValue(null);
  const response = await proxy(request);
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toContain("/login");
});
