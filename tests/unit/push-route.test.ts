import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "@/app/api/push/route";
import { DELETE, POST as subscribe } from "@/app/api/push/subscription/route";
import { POST as sendTest } from "@/app/api/push/test/route";
import type { Actor } from "@/application/ports/actor";
import { NotFoundError, RateLimitedError } from "@/application/shared/errors";
import { anna, marina, timur } from "../fakes/identity";

const mocks = vi.hoisted(() => ({
  getActor: vi.fn(),
  requireStudent: vi.fn(),
  configuration: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  test: vi.fn(),
  error: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/app/_lib/get-actor", () => ({
  getActor: mocks.getActor,
  requireStudent: mocks.requireStudent,
}));
vi.mock("@/composition/container", () => ({
  notifications: {
    push: {
      getConfiguration: { execute: mocks.configuration },
      subscribe: { execute: mocks.subscribe },
      unsubscribe: { execute: mocks.unsubscribe },
      test: { execute: mocks.test },
      getAppOrigin: () => "https://pulse.example",
    },
  },
  system: { logger: { error: mocks.error } },
}));

const endpoint = "https://fcm.googleapis.com/fcm/send/unit-test";
const subscription = {
  endpoint,
  expirationTime: null,
  keys: { p256dh: `B${"a".repeat(86)}`, auth: "a".repeat(22) },
};
const mutations = [
  {
    method: "POST",
    path: "subscription",
    handler: subscribe,
    input: subscription,
    execute: mocks.subscribe,
  },
  {
    method: "DELETE",
    path: "subscription",
    handler: DELETE,
    input: { endpoint },
    execute: mocks.unsubscribe,
  },
  {
    method: "POST",
    path: "test",
    handler: sendTest,
    input: { endpoint },
    execute: mocks.test,
  },
] as const;
const teacher: Actor = {
  kind: "teacher",
  userId: "teacher-user",
  teacherId: "teacher-id",
};

function request(
  route: (typeof mutations)[number],
  origin: string | null = "https://pulse.example",
  body = JSON.stringify(route.input),
  headers: Record<string, string> = {},
) {
  return new Request(`http://127.0.0.1:3000/api/push/${route.path}`, {
    method: route.method,
    headers: {
      "Content-Type": "application/json",
      ...(origin === null ? {} : { Origin: origin }),
      ...headers,
    },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getActor.mockResolvedValue(anna);
  mocks.requireStudent.mockResolvedValue(anna);
  mocks.configuration.mockResolvedValue({ publicKey: null, endpoints: [] });
  for (const route of mutations)
    route.execute.mockReset().mockResolvedValue({ ok: true });
});

it.each([
  { actor: null, status: 401, label: "аноним" },
  { actor: marina, status: 403, label: "сотрудник" },
  { actor: teacher, status: 403, label: "преподаватель" },
])(
  "$label не читает конфигурацию и не меняет подписки",
  async ({ actor, status }) => {
    mocks.getActor.mockResolvedValue(actor);
    const responses = [await GET()];
    for (const route of mutations)
      responses.push(await route.handler(request(route)));
    for (const response of responses) {
      expect(response.status).toBe(status);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("Location")).toBeNull();
      expect(await response.json()).toHaveProperty("error");
    }
    expect(mocks.requireStudent).not.toHaveBeenCalled();
    expect(mocks.configuration).not.toHaveBeenCalled();
    for (const route of mutations) expect(route.execute).not.toHaveBeenCalled();
  },
);

it.each([anna, timur])(
  "конфигурация выдаёт только публичный ключ и свои endpoints для $userId",
  async (actor) => {
    mocks.getActor.mockResolvedValue(actor);
    mocks.requireStudent.mockResolvedValue(actor);
    const configuration = {
      publicKey: "public-vapid-key",
      endpoints: [endpoint],
    };
    mocks.configuration.mockResolvedValue(configuration);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual(configuration);
    expect(mocks.configuration).toHaveBeenCalledExactlyOnceWith(actor);
  },
);

it.each(mutations)(
  "$method $path получает Actor только из сессии и доверяет APP_ORIGIN за прокси",
  async (route) => {
    const response = await route.handler(request(route));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.requireStudent).toHaveBeenCalledOnce();
    expect(route.execute).toHaveBeenCalledExactlyOnceWith(anna, route.input);
  },
);

it.each([
  null,
  "null",
  "https://evil.example",
  "https://pulse.example.evil.example",
  "https://pulse.example/",
  "http://pulse.example",
])(
  "мутации отклоняют Origin %s даже с поддельными Host и Forwarded",
  async (origin) => {
    for (const route of mutations) {
      const response = await route.handler(
        request(route, origin, undefined, {
          Host: "evil.example",
          "X-Forwarded-Host": "evil.example",
          "X-Forwarded-Proto": "https",
        }),
      );
      expect(response.status).toBe(403);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.json()).toHaveProperty("error");
      expect(route.execute).not.toHaveBeenCalled();
    }
  },
);

it.each(mutations)(
  "$method $path отвергает повреждённый и слишком большой JSON до use case",
  async (route) => {
    for (const body of [
      "{",
      JSON.stringify({ endpoint, extra: "x".repeat(4096) }),
    ]) {
      const response = await route.handler(request(route, undefined, body));
      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.json()).toHaveProperty("error");
    }
    expect(route.execute).not.toHaveBeenCalled();
  },
);

it.each([
  { error: new NotFoundError(), status: 404 },
  { error: new RateLimitedError(), status: 429 },
  {
    error: new Error("endpoint-and-private-key-must-stay-private"),
    status: 500,
  },
])(
  "ошибка use case возвращает $status без внутренних данных",
  async ({ error, status }) => {
    mocks.unsubscribe.mockRejectedValue(error);
    const route = mutations[1];
    const response = await route.handler(request(route));
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).not.toContain("endpoint-and-private-key");
    expect(JSON.stringify(mocks.error.mock.calls)).not.toContain(
      "endpoint-and-private-key",
    );
  },
);
