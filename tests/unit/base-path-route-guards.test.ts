import { expect, it, vi } from "vitest";
import {
  requireStaff,
  requireStudent,
  requireTeacher,
} from "@/app/_lib/get-actor";
import { identity } from "@/composition/container";
import { anna, marina } from "../fakes/identity";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("@/composition/container", () => ({
  identity: {
    getCurrentActor: { execute: vi.fn() },
    sessionCookie: { name: "__Host-pulse-session" },
  },
}));

it.each(["", "/dekanat"])(
  "guards: route Location с папкой, страницы без двойного префикса %s",
  async (base) => {
    vi.stubEnv("BASE_PATH", base);
    vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "true");
    vi.mocked(identity.getCurrentActor.execute).mockResolvedValue(null);
    for (const guard of [requireStudent, requireStaff, requireTeacher]) {
      await expect(guard({ routeHandler: true })).rejects.toMatchObject({
        digest: `NEXT_REDIRECT;replace;${base}/login;307;`,
      });
      await expect(guard()).rejects.toMatchObject({
        digest: "NEXT_REDIRECT;replace;/login;307;",
      });
    }
    vi.mocked(identity.getCurrentActor.execute).mockResolvedValue({
      actor: marina,
      expiresAt: "2026-11-22T12:00:00.000Z",
      renewed: false,
    });
    await expect(requireStudent({ routeHandler: true })).rejects.toMatchObject({
      digest: `NEXT_REDIRECT;replace;${base}/staff/requests;307;`,
    });
    vi.mocked(identity.getCurrentActor.execute).mockResolvedValue({
      actor: { kind: "teacher", userId: "teacher", teacherId: "teacher" },
      expiresAt: "2026-11-22T12:00:00.000Z",
      renewed: false,
    });
    await expect(requireStudent({ routeHandler: true })).rejects.toMatchObject({
      digest: `NEXT_REDIRECT;replace;${base}/teacher;307;`,
    });
    vi.mocked(identity.getCurrentActor.execute).mockResolvedValue({
      actor: anna,
      expiresAt: "2026-11-22T12:00:00.000Z",
      renewed: false,
    });
    await expect(requireStaff({ routeHandler: true })).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;403",
    });
  },
);
