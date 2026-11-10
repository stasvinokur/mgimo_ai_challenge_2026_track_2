import { expect, it, vi } from "vitest";
import {
  PasskeyRequestError,
  passkeyRequest,
} from "@/ui/identity/passkey-request";

it.each([
  [403, "PASSKEY_REAUTHENTICATION_REQUIRED"],
  [409, "PASSKEY_LIMIT_REACHED"],
  [429, "RATE_LIMITED"],
] as const)(
  "распознаёт код отказа %s / %s для локализованной подсказки",
  async (status, code) => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            code,
            message: "Серверный текст не является переводом UI",
          },
        },
        { status },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(
        passkeyRequest("/registration/verify", "POST", { response: {} }),
      ).rejects.toMatchObject({ code });
      expect(fetch).toHaveBeenCalledWith(
        "/api/passkeys/registration/verify",
        expect.objectContaining({
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  },
);

it("не принимает неизвестный код сервера за подсказку лимита", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Внутренние подробности",
          },
        },
        { status: 500 },
      ),
    ),
  );
  try {
    const result = passkeyRequest("/registration/verify", "POST", {});
    await expect(result).rejects.not.toBeInstanceOf(PasskeyRequestError);
    await expect(result).rejects.toThrow("PASSKEY_REQUEST_FAILED");
  } finally {
    vi.unstubAllGlobals();
  }
});
