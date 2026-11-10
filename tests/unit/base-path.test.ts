import { afterEach, describe, expect, it, vi } from "vitest";
import {
  absoluteAppUrl,
  appPath,
  validateBasePath,
  withoutBasePath,
} from "@/application/shared/app-path.mjs";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/infrastructure/auth/session-cookie";

afterEach(() => vi.resetModules());

describe("папка приложения", () => {
  it.each(["", "/dekanat"])(
    "Next: настройка сборки и вход /папка/ %s",
    async (base) => {
      vi.stubEnv("BASE_PATH", base);
      vi.resetModules();
      const config = (await import("../../next.config")).default;
      expect(config.basePath).toBe(base);
      expect(config.env?.BASE_PATH).toBe(base);
      expect(config.skipTrailingSlashRedirect).toBe(Boolean(base));
      const headers = await config.headers?.();
      expect(
        headers?.find((rule) => rule.source === "/sw.js")?.headers,
      ).toContainEqual({ key: "Service-Worker-Allowed", value: `${base}/` });
    },
  );
  it.each(["/api", "/today", "/schedule", "/dekanat"])(
    "папка %s может совпасть с именем маршрута",
    (base) => {
      vi.stubEnv("BASE_PATH", base);
      expect(appPath(`${base}/data`, base)).toBe(`${base}${base}/data`);
      expect(
        absoluteAppUrl("https://pulse.example", `${base}/data`, base),
      ).toBe(`https://pulse.example${base}${base}/data`);
    },
  );
  it.each([undefined, "", "/dekanat", "/a-2", "/123"])(
    "принимает %s",
    (value) => {
      expect(validateBasePath(value)).toBe(value ?? "");
    },
  );
  it.each([
    "/",
    "dekanat",
    "/dekanat/",
    "/a/b",
    "/Dekanat",
    "/деканат",
    " /a",
    "/a?b",
    "/a#b",
    "/a%2fb",
    "/a_b",
    "//a",
    "/a\nb",
    "/a\n",
    "/a\r",
    "/a\u2028",
    "/a\u2029",
  ])("отклоняет %s", (value) => {
    expect(() => validateBasePath(value)).toThrow("BASE_PATH");
  });
  it.each(["", "/dekanat"])(
    "пути, абсолютные ссылки и cookie: %s",
    async (base) => {
      vi.stubEnv("BASE_PATH", base);
      vi.resetModules();
      expect(appPath("/today?view=day#lesson", base)).toBe(
        `${base}/today?view=day#lesson`,
      );
      expect(absoluteAppUrl("https://pulse.example", "/verify/abc", base)).toBe(
        `https://pulse.example${base}/verify/abc`,
      );
      expect(withoutBasePath(`${base}/today`, base)).toBe("/today");
      if (base) {
        expect(withoutBasePath("/today", base)).toBeNull();
        expect(withoutBasePath("/dekanat-other/today", base)).toBeNull();
      }
      expect(SESSION_COOKIE).toBe("__Host-pulse-session");
      expect(sessionCookieOptions("2026-11-22T12:00:00.000Z")).toMatchObject({
        path: "/",
        secure: true,
        httpOnly: true,
      });
      const language = await import("@/ui/i18n/language");
      const settings = await import("@/ui/settings/accessibility");
      const suffix = base.replace("/", "-");
      expect(language.LANGUAGE_COOKIE).toBe(`pulse-language${suffix}`);
      expect(language.languageCookie("en", true)).toContain(`Path=${base}/;`);
      for (const option of settings.accessibilityOptions) {
        expect(option.cookie.endsWith(suffix)).toBe(true);
        expect(settings.accessibilityCookie(option.key, true, true)).toContain(
          `Path=${base}/;`,
        );
        expect(
          settings.parseAccessibilitySettings((name) =>
            name === option.cookie ? "on" : undefined,
          )[option.key],
        ).toBe(true);
      }
      const { pwaManifest, offlineDocument } = await import(
        "@/ui/shell/pwa-assets.mjs"
      );
      const manifest = pwaManifest();
      expect(manifest).toMatchObject({
        start_url: `${base}/today`,
        scope: `${base}/`,
        id: `${base}/`,
      });
      for (const icon of manifest.icons)
        expect(icon.src.startsWith(`${base}/icons/`)).toBe(true);
      const html = offlineDocument();
      expect(html).toContain(`rel="icon" href="${base}/favicon.svg"`);
      for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g))
        expect(match[1]?.startsWith(`${base}/`)).toBe(true);
      const { themeScript } = await import("@/ui/shell/theme");
      expect(themeScript).toContain(`"pulse-theme${suffix}"`);
    },
  );
});
