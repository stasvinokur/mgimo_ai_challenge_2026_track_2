import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import RootLayout from "@/app/layout";
import {
  accessibilityClasses,
  accessibilityCookie,
  accessibilityOptions,
  parseAccessibilitySettings,
} from "@/ui/settings/accessibility";
import { SettingsCard } from "@/ui/settings/settings-card";
import { SettingsProvider } from "@/ui/settings/settings-provider";

const mocks = vi.hoisted(() => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("next/headers", () => mocks);
vi.mock("@/composition/container", () => ({
  getConcept: { execute: () => ({ notice: "Все данные вымышлены" }) },
}));
vi.mock("@/ui/shell/pwa-registration", () => ({
  PwaRegistration: () => null,
}));
vi.mock("@/ui/shell/providers", () => ({
  Providers: ({ children }: { children: ReactNode }) => children,
}));

describe("настройки на устройстве", () => {
  it("при отсутствии cookie все режимы выключены", () => {
    const settings = parseAccessibilitySettings(() => undefined);
    expect(settings).toEqual({
      largeText: false,
      highContrast: false,
      reducedMotion: false,
    });
    expect(accessibilityClasses(settings)).toBe("");
  });

  it("три режима независимы во всех восьми сочетаниях", () => {
    for (let mask = 0; mask < 8; mask++) {
      const cookies = new Map<string, string>(
        accessibilityOptions.map((option, index) => [
          option.cookie,
          mask & (1 << index) ? "on" : "off",
        ]),
      );
      const settings = parseAccessibilitySettings((name) => cookies.get(name));
      const classes = accessibilityClasses(settings).split(" ").filter(Boolean);
      for (const [index, option] of accessibilityOptions.entries()) {
        const enabled = Boolean(mask & (1 << index));
        expect(settings[option.key]).toBe(enabled);
        expect(classes.includes(option.className)).toBe(enabled);
      }
    }
  });

  it.each([
    "true",
    "1",
    "ON",
    " on",
    "on ",
    "on%20",
    "on a11y-large-text",
    'on" lang="en',
    '<script>alert("cookie")</script>',
    "__proto__",
    "constructor",
    "on; pulse-high-contrast=on",
    "on\u0000",
  ])("неизвестное значение %s игнорируется", (value) => {
    const settings = parseAccessibilitySettings(() => value);
    expect(Object.values(settings)).toEqual([false, false, false]);
    expect(accessibilityClasses(settings)).toBe("");
  });

  it("не читает cookie сессии и других функций", () => {
    const read = vi.fn((_name: string) => "off");
    parseAccessibilitySettings(read);
    expect(read.mock.calls.map(([name]) => name)).toEqual(
      accessibilityOptions.map(({ cookie }) => cookie),
    );
  });

  it("cookie хранит только закрытое значение на устройстве на всех путях", () => {
    for (const option of accessibilityOptions) {
      for (const enabled of [true, false]) {
        for (const secure of [true, false]) {
          expect(accessibilityCookie(option.key, enabled, secure)).toBe(
            `${option.cookie}=${enabled ? "on" : "off"}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`,
          );
        }
      }
    }
  });

  it("карточка получает серверные значения и видимые доступные подписи", () => {
    const settings = parseAccessibilitySettings((name) =>
      name === "pulse-high-contrast" ? "on" : "off",
    );
    const props = {
      initialSettings: settings,
      children: createElement(SettingsCard),
    };
    const html = renderToStaticMarkup(createElement(SettingsProvider, props));
    expect(html).toContain('<h2 id="interface-settings-title">Настройки</h2>');
    expect(html.match(/role="switch"/g)).toHaveLength(3);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html.match(/aria-checked="false"/g)).toHaveLength(2);
    expect(html).toContain('data-settings-ready="false"');
    // Three accessibility switches plus the language select (TASK-47) wait for hydration.
    expect(
      html.match(
        /role="switch"[^>]*disabled=""|disabled=""[^>]*role="switch"/g,
      ),
    ).toHaveLength(3);
    expect(html.match(/<select[^>]*disabled=""/g)).toHaveLength(1);
    expect(html).not.toContain("aria-label=");
    for (const option of accessibilityOptions) {
      expect(html).toContain(`<span>${option.label}</span>`);
      expect(html).toContain(
        `aria-describedby="setting-${option.key}-description"`,
      );
      expect(html).toContain(option.description);
    }
  });

  it.each(["on", 'on" class="injected'])(
    "корневой layout ставит только известные классы до гидрации: %s",
    async (value) => {
      mocks.cookies.mockResolvedValue({ get: () => ({ value }) });
      mocks.headers.mockResolvedValue(new Headers({ "x-nonce": "test-nonce" }));
      const root = await RootLayout({ children: createElement("main") });
      const html = renderToStaticMarkup(root);
      expect(root.props.className).toBe(
        value === "on"
          ? "a11y-large-text a11y-high-contrast a11y-reduced-motion"
          : "",
      );
      expect(html).toContain(`class="${root.props.className}"`);
      expect(html).not.toContain("injected");
      const providers = root.props.children.props.children;
      expect(providers.props.nonce).toBe("test-nonce");
      expect(Object.values(providers.props.settings)).toEqual(
        Array(3).fill(value === "on"),
      );
    },
  );
});
