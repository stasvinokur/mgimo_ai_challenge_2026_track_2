import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "@/app/api/search/suggest/route";
import type { Actor } from "@/application/ports/actor";
import { RateLimitedError } from "@/application/shared/errors";
import { searchFixture } from "../fakes/search";

const mocks = vi.hoisted(() => ({
  getActor: vi.fn<() => Promise<Actor | null>>(),
  execute: vi.fn(),
  error: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/app/_lib/get-actor", () => ({ getActor: mocks.getActor }));
vi.mock("@/composition/modules/search", () => ({
  searchSuggestions: { execute: mocks.execute },
}));
vi.mock("@/composition/container", () => ({
  system: { logger: { error: mocks.error } },
}));

let fixture: ReturnType<typeof searchFixture>;
beforeEach(() => {
  vi.clearAllMocks();
  fixture = searchFixture();
  mocks.getActor.mockResolvedValue(fixture.anna);
  mocks.execute.mockImplementation(fixture.search.execute.bind(fixture.search));
});
const get = (params = "q=география") =>
  GET(new Request(`https://pulse.example/api/search/suggest?${params}`));

it.each([
  [null, 401],
  [{ kind: "staff", userId: "staff", staffId: "staff", facultyIds: [] }, 403],
  [{ kind: "teacher", userId: "teacher", teacherId: "teacher" }, 403],
] as const)("%j получает %s до чтения и валидации", async (actor, status) => {
  mocks.getActor.mockResolvedValue(actor);
  const response = await get("q=а");
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(await response.text()).not.toContain("география");
  expect(mocks.execute).not.toHaveBeenCalled();
});

it("извлекает только q; owner берётся из сессии; ответ совпадает с SearchCabinet", async () => {
  const response = await get(
    "q=география&studentId=timur&userId=timur&faculty=other&unknown=x",
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(fixture.anna, {
    q: "география",
  });
  expect(await response.json()).toEqual(
    await fixture.search.execute(fixture.anna, { q: "география" }),
  );
  expect(fixture.logs).toEqual([]);
  expect(mocks.error).not.toHaveBeenCalled();
});

it.each(["", "q=", "q=а", `q=${"а".repeat(81)}`])(
  "%s не проходит ту же схему",
  async (params) => {
    const response = await get(params);
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(fixture.grades.calls).toEqual([]);
    expect(mocks.error).not.toHaveBeenCalled();
  },
);

it("сбой источника не пишет запрос и детали ошибки в лог или ответ", async () => {
  vi.spyOn(fixture.schedule, "findForStudent").mockRejectedValue(
    new Error("чувствительный запрос география"),
  );
  const response = await get();
  const body = await response.json();
  expect(body.groups[0].status).toBe("error");
  expect(fixture.logs).toEqual([
    {
      event: "search_source_unavailable",
      context: { code: "SEARCH_SCHEDULE_UNAVAILABLE" },
    },
  ]);
  expect(JSON.stringify(body)).not.toContain("чувствительный");
});

it("неожиданный сбой отдаёт 500 no-store и только фиксированный код в лог", async () => {
  mocks.execute.mockRejectedValue(new Error("чувствительный запрос"));
  const response = await get();
  expect(response.status).toBe(500);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(await response.text()).not.toContain("чувствительный");
  expect(mocks.error).toHaveBeenCalledExactlyOnceWith("unexpected_error", {
    code: "INTERNAL_ERROR",
  });
});

it("исчерпанный лимит отдаёт 429 no-store без данных и error логов", async () => {
  mocks.execute.mockRejectedValue(new RateLimitedError());
  const response = await get();
  expect(response.status).toBe(429);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const body = await response.json();
  expect(body.error.code).toBe("RATE_LIMITED");
  expect(JSON.stringify(body)).not.toContain("географ");
  expect(mocks.error).not.toHaveBeenCalled();
});

it.each(["cross-site", "same-site", "none", "", "unexpected"])(
  "Sec-Fetch-Site=%s отклоняется до чтения сессии",
  async (site) => {
    const response = await GET(
      new Request("https://pulse.example/api/search/suggest?q=география", {
        headers: { "Sec-Fetch-Site": site },
      }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.getActor).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  },
);

it("Sec-Fetch-Site=same-origin допускает запрос", async () => {
  const response = await GET(
    new Request("https://pulse.example/api/search/suggest?q=география", {
      headers: { "Sec-Fetch-Site": "same-origin" },
    }),
  );
  expect(response.status).toBe(200);
  await response.text();
});

it.each(["\u0000\u0000", "гео\u0009графия", "\nгеография", "география\u0085"])(
  "управляющие символы дают 400 без чтений и error логов",
  async (q) => {
    const response = await get(new URLSearchParams({ q }).toString());
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(fixture.grades.calls).toEqual([]);
    expect(fixture.logs).toEqual([]);
    expect(mocks.error).not.toHaveBeenCalled();
    await response.text();
  },
);
