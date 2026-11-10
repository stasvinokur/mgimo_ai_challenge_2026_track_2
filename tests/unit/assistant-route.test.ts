import { cookies } from "next/headers";
import { beforeEach, expect, it, vi } from "vitest";
import { getActor, requireStudent } from "@/app/_lib/get-actor";
import { POST } from "@/app/api/assistant/route";
import { AssistantBusyError } from "@/application/assistant/errors";
import { assistant } from "@/composition/container";
import { getLanguage } from "@/ui/i18n/server";
import { anna, marina } from "../fakes/identity";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/ui/i18n/server", () => ({ getLanguage: vi.fn() }));
vi.mock("@/app/_lib/get-actor", () => ({
  getActor: vi.fn(),
  requireStudent: vi.fn(),
}));
vi.mock("@/composition/container", () => ({
  identity: { sessionCookie: { name: "__Host-pulse-session" } },
  assistant: {
    getAppOrigin: () => process.env.APP_ORIGIN || undefined,
    getClientIp: vi.fn(() => "198.51.100.7"),
    askAssistant: { execute: vi.fn() },
  },
  system: { logger: { error: vi.fn() } },
}));
const sessionToken = "a".repeat(43);
const getCookie = vi.fn();
const input = {
  action: "ask",
  threadId: "00000000-0000-7000-8000-000000000099",
  question: "Следующая пара",
};
function request(headers: Record<string, string>) {
  return new Request("http://0.0.0.0:3118/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(input),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  getCookie.mockReturnValue({
    name: "__Host-pulse-session",
    value: sessionToken,
  });
  vi.mocked(cookies).mockResolvedValue({
    get: getCookie,
  } as unknown as Awaited<ReturnType<typeof cookies>>);
  vi.mocked(getLanguage).mockResolvedValue("ru");
  vi.stubEnv("APP_ORIGIN", "https://pulse.example");
  vi.mocked(getActor).mockResolvedValue(anna);
  vi.mocked(requireStudent).mockResolvedValue(
    anna as Awaited<ReturnType<typeof requireStudent>>,
  );
  vi.mocked(assistant.askAssistant.execute).mockResolvedValue(
    (async function* () {
      yield { type: "text" as const, text: "Проверено" };
    })(),
  );
});

it.each(["ru", "en"] as const)(
  "SSE %s переводит кодовое сообщение один раз и сохраняет текст модели дословно",
  async (language) => {
    vi.mocked(getLanguage).mockResolvedValue(language);
    const modelText = "Ответ модели: **текст** — 42.\n";
    vi.mocked(assistant.askAssistant.execute).mockResolvedValue(
      (async function* () {
        yield {
          type: "message" as const,
          code: "refused" as const,
          params: {},
        };
        yield { type: "text" as const, text: modelText };
      })(),
    );
    const response = await POST(request({ origin: "https://pulse.example" }));
    expect(response.status).toBe(200);
    const parts = (await response.text())
      .split("\n")
      .filter((line) => line.startsWith("data: {"))
      .map((line) => JSON.parse(line.slice(6)));
    const deltas = parts
      .filter((part) => part.type === "text-delta")
      .map((part) => part.delta);
    expect(deltas).toEqual([
      language === "ru"
        ? "Я могу помочь только с вашими данными. Оценки и заявки других студентов недоступны."
        : "I can only help with your own details. Other students’ grades and requests are unavailable.",
      modelText,
    ]);
    expect(parts.some((part) => part.type === "data-assistant")).toBe(false);
    expect(vi.mocked(requireStudent).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(getLanguage).mock.invocationCallOrder[0] ?? 0,
    );
  },
);

it.each([
  { actor: null, status: 401 },
  { actor: marina, status: 403 },
])(
  "нет студенческой роли → $status до выбора языка",
  async ({ actor, status }) => {
    vi.mocked(getActor).mockResolvedValue(actor);
    expect(
      (await POST(request({ origin: "https://pulse.example" }))).status,
    ).toBe(status);
    expect(getLanguage).not.toHaveBeenCalled();
    expect(assistant.askAssistant.execute).not.toHaveBeenCalled();
  },
);

it("APP_ORIGIN разрешает браузерный Origin при другом request.url и передаёт серверный IP", async () => {
  const response = await POST(
    request({
      origin: "https://pulse.example",
      host: "binding.internal:3118",
      "x-forwarded-for": "203.0.113.2, 198.51.100.7",
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("Проверено");
  expect(assistant.getClientIp).toHaveBeenCalledWith(
    "203.0.113.2, 198.51.100.7",
  );
  expect(assistant.askAssistant.execute).toHaveBeenCalledWith(
    anna,
    input,
    { ip: "198.51.100.7" },
    sessionToken,
  );
  expect(getCookie).toHaveBeenCalledWith("__Host-pulse-session");
});
it("передаёт токен только из серверного cookie отдельным аргументом и не включает его в SSE", async () => {
  const response = await POST(
    new Request(
      "http://0.0.0.0:3118/api/assistant?sessionToken=forged-session",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://pulse.example",
        },
        body: JSON.stringify(input),
      },
    ),
  );
  expect(response.status).toBe(200);
  expect(assistant.askAssistant.execute).toHaveBeenCalledExactlyOnceWith(
    anna,
    input,
    { ip: "198.51.100.7" },
    sessionToken,
  );
  const body = await response.text();
  expect(body).not.toContain(sessionToken);
  expect(body).not.toContain("forged-session");
});
it.each([
  "https://foreign.example",
  "null",
  "https://pulse.example.evil",
  "https://pulse.example/path",
])("чужой/невалидный Origin %s → 403", async (origin) => {
  expect((await POST(request({ origin, host: "pulse.example" }))).status).toBe(
    403,
  );
  expect(assistant.askAssistant.execute).not.toHaveBeenCalled();
});
it("нет Origin → 403, до чтения тела и рантайма", async () => {
  expect((await POST(request({ host: "pulse.example" }))).status).toBe(403);
  expect(assistant.askAssistant.execute).not.toHaveBeenCalled();
});
it.each([
  { origin: "http://localhost:3118", host: "localhost:3118" },
  {
    origin: "https://pulse.example",
    host: "binding.internal:3118",
    "x-forwarded-host": "pulse.example",
    "x-forwarded-proto": "https",
  },
])("без APP_ORIGIN использует Host/прокси: $origin", async (headers) => {
  vi.stubEnv("APP_ORIGIN", undefined);
  const response = await POST(
    request(
      Object.fromEntries(
        Object.entries(headers).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
    ),
  );
  expect(response.status).toBe(200);
  await response.text();
});
it("настроенный APP_ORIGIN имеет приоритет над присланным host", async () => {
  expect(
    (
      await POST(
        request({
          origin: "https://foreign.example",
          "x-forwarded-host": "foreign.example",
          "x-forwarded-proto": "https",
        }),
      )
    ).status,
  ).toBe(403);
});
it("409 занятого пользователя содержит понятный текст и фиксированный код", async () => {
  vi.mocked(assistant.askAssistant.execute).mockRejectedValue(
    new AssistantBusyError(),
  );
  const response = await POST(request({ origin: "https://pulse.example" }));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: {
      code: "ASSISTANT_BUSY",
      message: "Подождите ответа на предыдущий вопрос.",
    },
  });
});
