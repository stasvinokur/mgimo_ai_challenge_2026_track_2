import { beforeEach, expect, it, vi } from "vitest";
import { mapRouteError } from "@/app/_lib/map-errors";
import { GET, POST } from "@/app/api/me/onboarding/route";
import { ForbiddenError, ValidationError } from "@/application/shared/errors";

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  get: vi.fn(),
  complete: vi.fn(),
  hide: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/app/_lib/get-actor", () => ({ getActor: mocks.actor }));
vi.mock("@/composition/container", () => ({
  onboarding: {
    getMyOnboarding: { execute: mocks.get },
    completeStep: { execute: mocks.complete },
    hide: { execute: mocks.hide },
  },
  system: {
    getEnv: () => "https://pulse.test",
    logger: { error: vi.fn() },
  },
}));

const actor = {
  kind: "student",
  userId: "session-user",
  studentId: "session-student",
  facultyId: "session-faculty",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ORIGIN", "https://pulse.test");
  mocks.actor.mockResolvedValue(actor);
  mocks.get.mockResolvedValue({ steps: [], completed: 0, total: 0 });
  mocks.complete.mockResolvedValue({ steps: [], completed: 1, total: 5 });
  mocks.hide.mockResolvedValue(null);
});

function request(body: unknown, extra: Record<string, string> = {}) {
  return new Request("http://127.0.0.1:3146/api/me/onboarding", {
    method: "POST",
    headers: {
      Origin: "https://pulse.test",
      Host: "pulse.test",
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
      ...extra,
    },
    body: JSON.stringify(body),
  });
}

it("GET читает только actor сессии и запрещает кэширование", async () => {
  const response = await GET(
    new Request("https://pulse.test/api/me/onboarding"),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ steps: [], completed: 0, total: 0 });
  expect(mocks.get).toHaveBeenCalledExactlyOnceWith(actor);
});

it("POST со внешним APP_ORIGIN работает за внутренним адресом standalone", async () => {
  const response = await POST(request({ stepCode: "schedule" }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ steps: [], completed: 1, total: 5 });
  expect(mocks.complete).toHaveBeenCalledExactlyOnceWith(actor, {
    stepCode: "schedule",
  });
});

it("без APP_ORIGIN сравнивает Origin с Host, а не адресом привязки", async () => {
  vi.stubEnv("APP_ORIGIN", "");
  const response = await POST(
    request({ stepCode: "install" }, { Origin: "http://pulse.test" }),
  );
  expect(response.status).toBe(200);
  await response.json();
});

it("скрытие получает только actor сессии и возвращает null", async () => {
  const response = await POST(request({ action: "hide" }));
  expect(response.status).toBe(200);
  expect(await response.json()).toBeNull();
  expect(mocks.hide).toHaveBeenCalledExactlyOnceWith(actor);
});

it.each(["", "null", "https://foreign.test"])(
  "Origin %s не меняет данные",
  async (Origin) => {
    const response = await POST(request({ stepCode: "schedule" }, { Origin }));
    expect(response.status).toBe(403);
    await response.json();
    expect(mocks.complete).not.toHaveBeenCalled();
  },
);

it("cross-site блокируется даже с совпадающим Origin", async () => {
  const response = await POST(
    request({ action: "hide" }, { "Sec-Fetch-Site": "cross-site" }),
  );
  expect(response.status).toBe(403);
  await response.json();
  expect(mocks.hide).not.toHaveBeenCalled();
});

it.each([{ kind: "staff" }, { kind: "teacher" }])(
  "отклоняет чтение и запись без роли студента: %s",
  async (value) => {
    mocks.actor.mockResolvedValue(value);
    for (const response of [
      await GET(new Request("https://pulse.test/api/me/onboarding")),
      await POST(request({ action: "hide" })),
    ]) {
      expect(response.status).toBe(403);
      await response.json();
    }
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.hide).not.toHaveBeenCalled();
  },
);

it("аноним получает 401 без перенаправления и без чтения данных", async () => {
  mocks.actor.mockResolvedValue(null);
  for (const response of [
    await GET(new Request("https://pulse.test/api/me/onboarding")),
    await POST(request({ stepCode: "schedule" })),
    await POST(request({ action: "hide" })),
  ]) {
    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: "Требуется вход." });
  }
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.complete).not.toHaveBeenCalled();
  expect(mocks.hide).not.toHaveBeenCalled();
});

it.each(["userId", "studentId"])(
  "не принимает чужой %s в query или body",
  async (key) => {
    const responses = [
      await GET(
        new Request(`https://pulse.test/api/me/onboarding?${key}=foreign`),
      ),
      await POST(request({ stepCode: "schedule", [key]: "foreign" })),
      await POST(request({ action: "hide", [key]: "foreign" })),
    ];
    for (const response of responses) {
      expect(response.status).toBe(400);
      await response.json();
    }
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.hide).not.toHaveBeenCalled();
  },
);

it("невалидный JSON не приводит к записи", async () => {
  const response = await POST(
    new Request("https://pulse.test/api/me/onboarding", {
      method: "POST",
      headers: { Origin: "https://pulse.test" },
      body: "{",
    }),
  );
  expect(response.status).toBe(400);
  await response.json();
  expect(mocks.complete).not.toHaveBeenCalled();
});

it.each([new ForbiddenError(), new ValidationError({ stepCode: ["Ошибка"] })])(
  "ошибки use case проходят общий HTTP-маппинг",
  async (error) => {
    mocks.complete.mockRejectedValue(error);
    const response = await POST(request({ stepCode: "schedule" }));
    expect(response.status).toBe(mapRouteError(error).status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await response.json();
  },
);
