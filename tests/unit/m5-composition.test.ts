import { expect, it, vi } from "vitest";
import webPush from "web-push";
import { createPasskeyVerifier } from "@/composition/modules/passkey";
import { createPushSender } from "@/composition/modules/push";

vi.mock("server-only", () => ({}));

const settings = [
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
] as const;

it.each([undefined, ""])(
  "фабрика выключает push без VAPID и не требует других настроек (%s)",
  async (value) => {
    for (const key of settings) vi.stubEnv(key, value);
    vi.stubEnv("DATABASE_URL", undefined);
    vi.stubEnv("OLLAMA_API_KEY", undefined);
    const sender = createPushSender();
    expect(sender.enabled).toBe(false);
    await expect(
      sender.send(
        {
          endpoint: "https://push.example.invalid",
          keys: { p256dh: "", auth: "" },
        },
        { title: "Готово", body: "Проверьте кабинет", link: "/requests" },
      ),
    ).resolves.toEqual({ status: "disabled" });
  },
);

it.each(settings)(
  "неполный набор VAPID (%s) оставляет push выключенным",
  (missing) => {
    const keys = webPush.generateVAPIDKeys();
    vi.stubEnv("VAPID_PUBLIC_KEY", keys.publicKey);
    vi.stubEnv("VAPID_PRIVATE_KEY", keys.privateKey);
    vi.stubEnv("VAPID_SUBJECT", "mailto:push@example.invalid");
    vi.stubEnv(missing, "");
    expect(createPushSender().enabled).toBe(false);
  },
);

it("полный набор VAPID включает серверный адаптер", () => {
  const keys = webPush.generateVAPIDKeys();
  vi.stubEnv("VAPID_PUBLIC_KEY", keys.publicKey);
  vi.stubEnv("VAPID_PRIVATE_KEY", keys.privateKey);
  vi.stubEnv("VAPID_SUBJECT", "mailto:push@example.invalid");
  expect(createPushSender().enabled).toBe(true);
});

it("фабрика ключей доступа получает RP ID из APP_ORIGIN", async () => {
  vi.stubEnv("APP_ORIGIN", "http://localhost:3139");
  const verifier = createPasskeyVerifier();
  expect((await verifier.authenticationOptions({ credentials: [] })).rpId).toBe(
    "localhost",
  );
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3139");
  expect(() => createPasskeyVerifier()).toThrow();
});
