import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import RootLayout from "@/app/layout";
import { themeScript } from "@/ui/shell/theme";

const mocks = vi.hoisted(() => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("next/headers", () => mocks);
vi.mock("@/ui/shell/providers", () => ({
  Providers: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/ui/shell/pwa-registration", () => ({
  PwaRegistration: () => null,
}));

it("ранний скрипт с nonce CSP идёт перед страницей без изменения серверных props", async () => {
  mocks.cookies.mockResolvedValue({ get: () => undefined });
  mocks.headers.mockResolvedValue(
    new Headers({ "x-nonce": "theme-csp-nonce" }),
  );
  const root = await RootLayout({ children: createElement("main") });
  const providers = root.props.children.props.children;
  expect(providers.props.nonce).toBe("theme-csp-nonce");
  expect(providers.props.language).toBe("ru");
  expect(providers.props.settings).toEqual({
    largeText: false,
    highContrast: false,
    reducedMotion: false,
  });
  const html = renderToStaticMarkup(root);
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  expect(scripts).toHaveLength(1);
  expect(scripts[0]?.[1]).toContain('nonce="theme-csp-nonce"');
  expect(scripts[0]?.[2]).toBe(themeScript);
  expect(html.indexOf("<script")).toBeLessThan(
    html.indexOf('class="app-root"'),
  );
  expect(html.indexOf("</script>")).toBeLessThan(html.indexOf("<main"));
});
