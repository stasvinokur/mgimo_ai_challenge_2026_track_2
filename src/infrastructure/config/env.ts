import { z } from "zod";
import { demoAccounts } from "@/application/identity/demo-accounts";

const nonEmpty = z.string().min(1);
const httpUrl = z.url({ protocol: /^https?$/ });
const optionalSetting = z.preprocess(
  (value) => (value === "" ? undefined : value),
  nonEmpty.optional(),
);

export const envSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, hostname: /./ }),
  POSTGRES_PASSWORD: nonEmpty,
  APP_DOMAIN: z.hostname(),
  APP_ORIGIN: httpUrl,
  IMAGE_TAG: nonEmpty,
  COMPOSE_FILE: nonEmpty,
  OLLAMA_HOST: httpUrl,
  OLLAMA_API_KEY: nonEmpty,
  OLLAMA_MODEL: nonEmpty,
  OLLAMA_FALLBACK_MODEL: nonEmpty,
  ASSISTANT_RUNTIME: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.literal("mock").optional(),
  ),
  ICS_TOKEN_SECRET: z.string().min(32),
  VAPID_PUBLIC_KEY: optionalSetting,
  VAPID_PRIVATE_KEY: optionalSetting,
  VAPID_SUBJECT: optionalSetting,
  TTS_URL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    httpUrl.optional(),
  ),
  DEMO_LOGIN_HINTS: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(["on", "off"]).default("on"),
  ),
  DEMO_ACCOUNT_PASSWORDS: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .refine((value) => {
        const entries = value.split(",");
        const logins = entries.map((entry) => entry.split(":")[0]);
        return (
          entries.length === 4 &&
          new Set(logins).size === 4 &&
          entries.every(
            (entry) =>
              /^(anna|timur|marina|oleg):[^,:\s]{12,}$/u.test(entry) &&
              !/\s/u.test(entry),
          )
        );
      })
      .transform(
        (value) =>
          Object.fromEntries(
            value.split(",").map((entry) => entry.split(":")),
          ) as Record<"anna" | "timur" | "marina" | "oleg", string>,
      )
      .refine((passwords) =>
        Object.values(passwords).every((password) =>
          demoAccounts.every((account) => account.password !== password),
        ),
      )
      .optional(),
  ),
  TZ: z.literal("Europe/Moscow").default("Europe/Moscow"),
  APP_VERSION: nonEmpty.optional(),
});

type Environment = z.output<typeof envSchema>;

// Validate only the requested setting: health does not need LLM credentials.
export function getEnv<TKey extends keyof Environment>(
  key: TKey,
): Environment[TKey] {
  const result = envSchema.shape[key].safeParse(process.env[key]);
  if (!result.success) {
    // Zod issues may contain secret values; report the setting name only.
    throw new Error(`Проверьте переменную окружения ${key}.`);
  }
  return result.data as Environment[TKey];
}
