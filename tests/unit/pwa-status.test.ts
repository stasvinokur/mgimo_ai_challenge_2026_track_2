import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  snapshot: {
    savedAt: "2026-11-04T12:00:00.000Z",
    reason: "slow" as "slow" | "offline",
  },
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: () => [state.snapshot, () => undefined],
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/today" }));

import { PwaStatus } from "@/ui/shell/pwa-status";

it.each([
  ["slow", "Сеть медленная", "Нет сети"],
  ["offline", "Нет сети", "Сеть медленная"],
] as const)(
  "плашка %s объясняет настоящую причину показа копии",
  (reason, expected, absent) => {
    state.snapshot.reason = reason;
    const html = renderToStaticMarkup(createElement(PwaStatus));
    expect(html).toContain(`${expected} — показана версия от`);
    expect(html).not.toContain(absent);
    expect(html).toContain("15:00");
    expect(html).toContain("(МСК)");
  },
);
