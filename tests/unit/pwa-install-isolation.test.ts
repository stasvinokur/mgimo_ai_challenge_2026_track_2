import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ effects: [] as (() => unknown)[] }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => unknown) => hooks.effects.push(effect),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  hooks.effects = [];
});
it.each(["", "/dekanat"])(
  "скрытие установки читается из ключа своей папки %s",
  async (base) => {
    vi.stubEnv("BASE_PATH", base);
    vi.resetModules();
    const getItem = vi.fn().mockReturnValue("1");
    vi.stubGlobal("localStorage", { getItem });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const { PwaInstall } = await import("@/ui/shell/pwa-install");
    renderToStaticMarkup(createElement(PwaInstall));
    for (const effect of hooks.effects) effect();
    expect(getItem).toHaveBeenCalledExactlyOnceWith(
      `pulse-install-dismissed${base.replace("/", "-")}`,
    );
  },
);
