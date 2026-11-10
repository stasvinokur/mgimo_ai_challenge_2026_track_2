import { beforeEach, expect, it, vi } from "vitest";
import { version } from "../../package.json";
import { GET } from "../../src/app/api/health/route";
import { isDatabaseAvailable } from "../../src/infrastructure/db/health";

vi.mock("server-only", () => ({}));
vi.mock("../../src/infrastructure/db/health", () => ({
  isDatabaseAvailable: vi.fn(),
}));

beforeEach(() => vi.stubEnv("APP_VERSION", undefined));

it.each([
  { available: true, status: 200, body: "ok" },
  { available: false, status: 503, body: "unavailable" },
])(
  "health возвращает $status и версию без деталей БД",
  async ({ available, status, body }) => {
    vi.mocked(isDatabaseAvailable).mockResolvedValue(available);
    const response = await GET();
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: body, version });
  },
);

it.each([true, false])(
  "health читает APP_VERSION в рантайме независимо от доступности БД",
  async (available) => {
    vi.mocked(isDatabaseAvailable).mockResolvedValue(available);
    vi.stubEnv("APP_VERSION", "test-image-version");
    const response = await GET();
    expect(response.status).toBe(available ? 200 : 503);
    expect(await response.json()).toEqual({
      status: available ? "ok" : "unavailable",
      version: "test-image-version",
    });
    vi.stubEnv("APP_VERSION", "test-next-image-version");
    expect(await (await GET()).json()).toMatchObject({
      version: "test-next-image-version",
    });
  },
);
