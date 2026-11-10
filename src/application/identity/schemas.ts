import { z } from "zod";
import { ValidationError } from "../shared/errors";

const loginSchema = z.strictObject({
  login: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Введите логин.")
    .max(64, "Логин слишком длинный."),
  password: z
    .string()
    .min(1, "Введите пароль.")
    .max(1024, "Пароль слишком длинный."),
  ip: z.string().min(1).max(64),
});

export function parseLogin(input: unknown) {
  const result = loginSchema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(z.flattenError(result.error).fieldErrors);
  }
  return result.data;
}

export function safeNextPath(input: unknown): string | null {
  const result = z.string().max(2048).safeParse(input);
  if (!result.success) return null;
  const path = result.data;
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    [...path].some(
      (character) =>
        character === "\\" ||
        character.charCodeAt(0) <= 32 ||
        character.charCodeAt(0) === 127,
    )
  )
    return null;
  // Reject encoded separators and controls before URL normalization.
  if (/%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f|25)/i.test(path)) return null;
  const url = new URL(path, "https://pulse.invalid");
  if (url.origin !== "https://pulse.invalid" || url.pathname.startsWith("//"))
    return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

export function loginDestination(
  kind: "student" | "staff" | "teacher",
  next: unknown,
): string {
  const path = safeNextPath(next);
  const staffPath = path === "/staff" || path?.startsWith("/staff/");
  const teacherPath = /^\/teacher([/?#]|$)/.test(path ?? "");
  if (
    path &&
    (kind === "staff"
      ? staffPath
      : kind === "teacher"
        ? teacherPath
        : /^\/(today|schedule|grades|requests|notifications|profile|attend)([/?#]|$)/.test(
            path,
          ))
  )
    return path;
  return kind === "teacher"
    ? "/teacher"
    : kind === "staff"
      ? "/staff/requests"
      : "/today";
}

const passkeyBase64Url = z
  .string()
  .min(1)
  .max(8192)
  .regex(/^[A-Za-z0-9_-]+$/);
const passkeyResponseBase = {
  id: passkeyBase64Url,
  rawId: passkeyBase64Url,
  type: z.literal("public-key"),
  clientExtensionResults: z.record(z.string(), z.unknown()),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
};
const passkeyChallengeId = z.uuid();
const passkeyIp = z.string().min(1).max(64);
const passkeyRegistrationSchema = z.strictObject({
  challengeId: passkeyChallengeId,
  ip: passkeyIp,
  deviceName: z
    .string()
    .trim()
    .min(1, "Введите имя устройства.")
    .max(64, "Имя устройства должно быть не длиннее 64 символов.")
    .regex(/^[^\p{Cc}]+$/u, "Введите имя устройства без служебных символов."),
  response: z.strictObject({
    ...passkeyResponseBase,
    response: z
      .strictObject({
        clientDataJSON: passkeyBase64Url,
        attestationObject: z
          .string()
          .min(1)
          .max(65536)
          .regex(/^[A-Za-z0-9_-]+$/),
        transports: z.array(z.string().max(32)).max(8).optional(),
        publicKeyAlgorithm: z
          .number()
          .int()
          .min(-2147483648)
          .max(2147483647)
          .optional(),
        publicKey: passkeyBase64Url.optional(),
        authenticatorData: passkeyBase64Url.optional(),
      })
      .transform((response) => ({
        clientDataJSON: response.clientDataJSON,
        attestationObject: response.attestationObject,
        transports: response.transports,
      })),
  }),
});
const passkeyAuthenticationSchema = z.strictObject({
  challengeId: passkeyChallengeId,
  ip: passkeyIp,
  response: z.strictObject({
    ...passkeyResponseBase,
    response: z.strictObject({
      clientDataJSON: passkeyBase64Url,
      authenticatorData: passkeyBase64Url,
      signature: passkeyBase64Url,
      userHandle: passkeyBase64Url.optional(),
    }),
  }),
});

export function parsePasskeyRegistration(
  input: unknown,
  deviceNameOverride?: string,
) {
  const data =
    deviceNameOverride !== undefined &&
    input !== null &&
    typeof input === "object" &&
    !Array.isArray(input)
      ? { ...input, deviceName: deviceNameOverride }
      : input;
  const result = passkeyRegistrationSchema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(z.flattenError(result.error).fieldErrors);
  }
  return result.data;
}

export function parsePasskeyAuthentication(input: unknown) {
  const result = passkeyAuthenticationSchema.safeParse(input);
  if (!result.success) throw new ValidationError({});
  return result.data;
}

export function parsePasskeyIp(input: unknown) {
  const result = z.strictObject({ ip: passkeyIp }).safeParse(input);
  if (!result.success) throw new ValidationError({});
  return result.data.ip;
}

export function isPasskeyId(input: unknown): input is string {
  return passkeyChallengeId.safeParse(input).success;
}

export function parsePasskeyAuthenticationIp(input: unknown) {
  const result = z.object({ ip: passkeyIp }).safeParse(input);
  if (!result.success) throw new ValidationError({});
  return result.data.ip;
}
