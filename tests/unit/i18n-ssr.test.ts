import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import RootLayout from "@/app/layout";
import { shellMessages } from "@/ui/i18n/dictionaries/shell";
import { t } from "@/ui/i18n/translate";

const mocks = vi.hoisted(() => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("next/headers", () => mocks);
vi.mock("@/ui/shell/providers", () => ({
  Providers: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/ui/shell/pwa-registration", () => ({
  PwaRegistration: () => null,
}));

it.each([
  { cookie: undefined, language: "ru" },
  { cookie: "ru", language: "ru" },
  { cookie: "en", language: "en" },
  { cookie: "EN", language: "ru" },
  { cookie: 'en" data-i18n-injected="true', language: "ru" },
] as const)(
  "SSR применяет только закрытый язык $cookie",
  async ({ cookie, language }) => {
    mocks.cookies.mockResolvedValue({
      get: (name: string) =>
        name === "pulse-language" && cookie !== undefined
          ? { value: cookie }
          : undefined,
    });
    mocks.headers.mockResolvedValue(
      new Headers({ "x-nonce": "i18n-test-nonce" }),
    );
    const root = await RootLayout({ children: createElement("main") });
    expect(root.props.lang).toBe(language);
    const providers = root.props.children.props.children;
    expect(providers.props.language).toBe(language);
    expect(providers.props.nonce).toBe("i18n-test-nonce");
    const html = renderToStaticMarkup(root);
    expect(html).toContain(`<html lang="${language}"`);
    expect(html).toContain(t(language, shellMessages, "competitionConcept"));
    expect(html).not.toContain("data-i18n-injected");
  },
);
