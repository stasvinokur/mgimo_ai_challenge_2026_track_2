import { beforeEach, expect, it, vi } from "vitest";
import {
  DELETE as deleteKey,
  GET as getKey,
} from "@/app/api/passkeys/[id]/route";
import { POST as authenticationOptions } from "@/app/api/passkeys/authentication/options/route";
import { POST as authenticate } from "@/app/api/passkeys/authentication/verify/route";
import { POST as registrationOptions } from "@/app/api/passkeys/registration/options/route";
import { POST as register } from "@/app/api/passkeys/registration/verify/route";
import { GET as listKeys } from "@/app/api/passkeys/route";
import {
  PasskeyLimitError,
  PasskeyReauthenticationRequiredError,
  PasskeyRegistrationRateLimitedError,
} from "@/application/identity/passkey-errors";
import { PASSKEY_LOGIN_MESSAGE } from "@/application/identity/passkeys";
import { ValidationError } from "@/application/shared/errors";
import { anna, marina } from "../fakes/identity";

const h = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    setCookie: vi.fn(),
    actor: vi.fn(),
    student: vi.fn(),
    staff: vi.fn(),
    list: vi.fn(),
    isDemoAccount: vi.fn(),
    get: vi.fn(),
    remove: vi.fn(),
    registrationOptions: vi.fn(),
    register: vi.fn(),
    authenticationOptions: vi.fn(),
    authenticate: vi.fn(),
    clientIp: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      h.values.has(name) ? { value: h.values.get(name) } : undefined,
    set: h.setCookie,
  }),
}));
vi.mock("@/app/_lib/get-actor", () => ({
  getActor: h.actor,
  requireStudent: h.student,
  requireStaff: h.staff,
}));
vi.mock("@/composition/container", () => ({
  identity: {
    passkeys: h,
    getAppOrigin: () => "https://pulse.example",
    getClientIp: h.clientIp,
    sessionCookie: {
      name: "__Host-pulse-session",
      options: (expiry: string) => ({
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        expires: new Date(expiry),
      }),
    },
  },
  system: { logger: { warn: h.warn, error: h.error } },
}));

function request(
  path: string,
  body: unknown = {},
  origin: string | null = "https://pulse.example",
) {
  return new Request(`http://127.0.0.1:3000/api/passkeys/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Sec-Fetch-Site": "same-origin",
      "X-Forwarded-For": "192.0.2.42",
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.values.clear();
  h.actor.mockResolvedValue(anna);
  h.student.mockResolvedValue(anna);
  h.staff.mockResolvedValue(marina);
  h.clientIp.mockReturnValue("192.0.2.42");
  h.list.mockResolvedValue([]);
  h.isDemoAccount.mockResolvedValue(false);
  h.get.mockResolvedValue({ id: "own" });
  h.remove.mockResolvedValue(undefined);
  h.register.mockResolvedValue(undefined);
  h.registrationOptions.mockResolvedValue({
    challengeId: "reg-id",
    options: { challenge: "reg" },
  });
  h.authenticationOptions.mockResolvedValue({
    challengeId: "auth-id",
    options: { challenge: "auth" },
  });
  h.authenticate.mockResolvedValue({
    token: "new-token",
    expiresAt: "2026-11-12T00:00:00Z",
    kind: "student",
  });
});

it("Origin сравнивается с APP_ORIGIN, адрес привязки сервера не считается доверенным", async () => {
  const allowed = await authenticationOptions(
    request("authentication/options"),
  );
  expect(allowed.status).toBe(200);
  expect(allowed.headers.get("cache-control")).toContain("no-store");
  expect(h.setCookie).toHaveBeenCalledWith(
    "__Host-passkey-authentication",
    "auth-id",
    {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 300,
    },
  );
  const failures: unknown[] = [];
  for (const origin of [
    null,
    "null",
    "https://evil.example",
    "http://127.0.0.1:3000",
  ]) {
    const response = await authenticationOptions(
      request("authentication/options", {}, origin),
    );
    expect(response.status).toBe(400);
    failures.push(await response.json());
  }
  expect(
    failures.every(
      (body) => JSON.stringify(body) === JSON.stringify(failures[0]),
    ),
  ).toBe(true);
  expect(h.authenticationOptions).toHaveBeenCalledTimes(1);
});

it("каждый защищённый endpoint проверяет сессию и роль до обращения к use case", async () => {
  const context = { params: Promise.resolve({ id: "own" }) };
  for (const actor of [
    null,
    { kind: "teacher", userId: "teacher", teacherId: "teacher" },
  ]) {
    h.actor.mockResolvedValue(actor);
    for (const response of [
      await listKeys(),
      await getKey(request("own"), context),
      await deleteKey(request("own"), context),
      await registrationOptions(request("registration/options")),
      await register(request("registration/verify")),
    ])
      expect(response.status).toBe(403);
  }
  for (const method of [
    h.list,
    h.isDemoAccount,
    h.get,
    h.remove,
    h.registrationOptions,
    h.register,
  ])
    expect(method).not.toHaveBeenCalled();
  h.actor.mockResolvedValue(marina);
  await listKeys();
  expect(h.staff).toHaveBeenCalledOnce();
  expect(h.list).toHaveBeenCalledWith(marina);
  expect(h.isDemoAccount).toHaveBeenCalledWith(marina);
});

it.each([false, true])(
  "GET списка возвращает признак демо %s только для владельца из сессии и запрещает кэширование",
  async (isDemoAccount) => {
    h.isDemoAccount.mockResolvedValue(isDemoAccount);
    const response = await listKeys();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      credentials: [],
      isDemoAccount,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(h.actor).toHaveBeenCalledOnce();
    expect(h.student).toHaveBeenCalledOnce();
    expect(h.list).toHaveBeenCalledExactlyOnceWith(anna);
    expect(h.isDemoAccount).toHaveBeenCalledExactlyOnceWith(anna);
    expect(h.staff).not.toHaveBeenCalled();
  },
);

it("регистрация привязывает challenge к cookie и получает владельца только из сессии", async () => {
  h.values.set("__Host-pulse-session", "session-from-cookie");
  await registrationOptions(request("registration/options"));
  expect(h.registrationOptions).toHaveBeenCalledWith(
    anna,
    "session-from-cookie",
  );
  h.values.set("__Host-passkey-registration", "cookie-challenge");
  await register(
    request("registration/verify", {
      deviceName: "Телефон",
      response: { id: "response" },
      challengeId: "client-override",
      ip: "198.51.100.10",
    }),
  );
  expect(h.register).toHaveBeenCalledWith(
    anna,
    {
      deviceName: "Телефон",
      response: { id: "response" },
      challengeId: "cookie-challenge",
      ip: "192.0.2.42",
    },
    "session-from-cookie",
  );
  expect(h.clientIp).toHaveBeenCalledExactlyOnceWith("192.0.2.42");
  expect(h.setCookie).toHaveBeenCalledWith(
    "__Host-passkey-registration",
    "",
    expect.objectContaining({ maxAge: 0, httpOnly: true, secure: true }),
  );
  expect(
    (await register(request("registration/verify", {}, "https://evil.example")))
      .status,
  ).toBe(403);
  expect(h.register).toHaveBeenCalledOnce();
});

it("оба этапа регистрации возвращают понятный отказ свежести без подмены cookie токеном из body", async () => {
  h.registrationOptions.mockRejectedValue(
    new PasskeyReauthenticationRequiredError(),
  );
  h.register.mockRejectedValue(new PasskeyReauthenticationRequiredError());
  for (const response of [
    await registrationOptions(request("registration/options")),
    await register(
      request("registration/verify", { sessionToken: "client-token" }),
    ),
  ]) {
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "PASSKEY_REAUTHENTICATION_REQUIRED",
        message: "Чтобы добавить ключ доступа, войдите заново",
      },
    });
  }
  expect(h.register).toHaveBeenCalledWith(anna, expect.any(Object), undefined);
});

it("лимит ключей возвращает Conflict с понятным текстом", async () => {
  h.registrationOptions.mockRejectedValue(new PasskeyLimitError());
  h.register.mockRejectedValue(new PasskeyLimitError());
  for (const response of [
    await registrationOptions(request("registration/options")),
    await register(request("registration/verify")),
  ]) {
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "PASSKEY_LIMIT_REACHED",
        message: new PasskeyLimitError().message,
      },
    });
  }
});

it("лимит успешных регистраций возвращает 429 без подмены серверного IP", async () => {
  h.register.mockRejectedValue(new PasskeyRegistrationRateLimitedError());
  const response = await register(
    request("registration/verify", { ip: "198.51.100.10" }),
  );
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({
    error: {
      code: "RATE_LIMITED",
      message: new PasskeyRegistrationRateLimitedError().message,
    },
  });
  expect(h.register).toHaveBeenCalledExactlyOnceWith(
    anna,
    { ip: "192.0.2.42", challengeId: undefined },
    undefined,
  );
});

it("вход использует серверные IP и challenge, общую cookie и безопасное назначение перехода", async () => {
  h.values.set("__Host-passkey-authentication", "cookie-challenge");
  h.values.set("__Host-pulse-session", "previous-token");
  const response = await authenticate(
    request("authentication/verify", {
      response: { id: "credential" },
      next: "https://evil.example",
    }),
  );
  expect(h.authenticate).toHaveBeenCalledWith(
    {
      challengeId: "cookie-challenge",
      ip: "192.0.2.42",
      response: { id: "credential" },
    },
    "previous-token",
  );
  expect(await response.json()).toEqual({ destination: "/today" });
  expect(h.setCookie).toHaveBeenCalledWith(
    "__Host-pulse-session",
    "new-token",
    expect.objectContaining({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    }),
  );
  h.authenticate.mockResolvedValue({
    token: "staff-token",
    expiresAt: "2026-11-12T00:00:00Z",
    kind: "staff",
  });
  expect(
    await (await authenticate(request("authentication/verify"))).json(),
  ).toEqual({ destination: "/staff/requests" });
});

it("испорченный JSON и лишние поля доходят до application rate limit, сбои дают одну ошибку", async () => {
  h.authenticate.mockRejectedValue(new ValidationError({}));
  const broken = request("authentication/verify");
  const malformed = new Request(broken.url, {
    method: "POST",
    headers: broken.headers,
    body: "{",
  });
  const response = await authenticate(malformed);
  expect(h.authenticate).toHaveBeenCalledWith(
    { ip: "192.0.2.42", challengeId: undefined },
    undefined,
  );
  const extra = await authenticate(
    request("authentication/verify", { userId: "attacker" }),
  );
  expect(h.authenticate).toHaveBeenLastCalledWith(
    { userId: "attacker", ip: "192.0.2.42", challengeId: undefined },
    undefined,
  );
  const origin = await authenticate(
    request("authentication/verify", {}, "https://evil.example"),
  );
  for (const item of [response, extra, origin]) {
    expect(item.status).toBe(400);
    expect(await item.json()).toEqual({
      error: { code: "PASSKEY_LOGIN_FAILED", message: PASSKEY_LOGIN_MESSAGE },
    });
  }
  expect(
    h.warn.mock.calls.every(
      (args) =>
        JSON.stringify(args) ===
        JSON.stringify([
          "passkey_http_failed",
          { code: "PASSKEY_LOGIN_FAILED" },
        ]),
    ),
  ).toBe(true);
});
