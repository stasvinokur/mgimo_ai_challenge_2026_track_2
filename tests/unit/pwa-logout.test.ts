import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  action: null as unknown as (previous: object) => Promise<object>,
  clear: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useActionState: (action: typeof mocks.action) => {
    mocks.action = action;
    return [{}, action, false];
  },
}));
vi.mock("@/app/(auth)/actions", () => ({ logout: mocks.logout }));
vi.mock("@/ui/shell/pwa-client", () => ({ clearPwaPages: mocks.clear }));

import { LogoutButton } from "@/app/(auth)/logout-button";

beforeEach(() => {
  mocks.clear.mockReset();
  mocks.logout.mockReset();
});
it.each([false, true])(
  "выход вызывается при ошибке очистки %s",
  async (failed) => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    if (failed)
      mocks.clear.mockRejectedValue(new Error("private error details"));
    else mocks.clear.mockResolvedValue(undefined);
    mocks.logout.mockResolvedValue({});
    LogoutButton();
    await mocks.action({});
    expect(mocks.logout).toHaveBeenCalledOnce();
    if (failed)
      expect(warning).toHaveBeenCalledExactlyOnceWith("PWA_CACHE_CLEAR_FAILED");
    else expect(warning).not.toHaveBeenCalled();
  },
);
