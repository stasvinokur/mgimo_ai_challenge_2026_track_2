import { beforeEach, expect, it, vi } from "vitest";
import Page from "@/app/(student)/search/page";
import { searchFixture } from "../fakes/search";

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  execute: vi.fn(),
  mapError: vi.fn(),
  language: vi.fn(),
}));
vi.mock("@/ui/i18n/server", () => ({ getLanguage: mocks.language }));
vi.mock("@/app/_lib/get-actor", () => ({ requireStudent: mocks.actor }));
vi.mock("@/app/_lib/map-errors", () => ({ mapPageError: mocks.mapError }));
vi.mock("@/composition/container", () => ({
  search: { execute: mocks.execute },
}));

let fixture: ReturnType<typeof searchFixture>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.language.mockResolvedValue("ru");
  fixture = searchFixture();
  mocks.actor.mockResolvedValue(fixture.anna);
  mocks.execute.mockImplementation(fixture.search.execute.bind(fixture.search));
});

it.each(["\u0000\u0000", "\nгеография", "география\u0085", "\t\t", "\n\n"])(
  "/search отклоняет Cc %j до I/O и логов",
  async (q) => {
    const page = await Page({ searchParams: Promise.resolve({ q }) });
    expect(page.props.validation).toBe("controlCharacters");
    expect(page.props.result).toBeUndefined();
    expect(fixture.grades.calls).toEqual([]);
    expect(fixture.regulations.calls).toEqual([]);
    expect(fixture.logs).toEqual([]);
    expect(mocks.mapError).not.toHaveBeenCalled();
  },
);

it.each([undefined, "", "   "])(
  "обычный пустой ввод %j остаётся начальным состоянием без поиска",
  async (q) => {
    const page = await Page({
      searchParams: Promise.resolve(q === undefined ? {} : { q }),
    });
    expect(page.props.validation).toBeUndefined();
    expect(page.props.result).toBeUndefined();
    expect(mocks.execute).not.toHaveBeenCalled();
  },
);

it("страница передаёт запрос и Actor из guard, игнорируя посторонние id", async () => {
  const page = await Page({
    searchParams: Promise.resolve({
      q: "география",
      studentId: "other",
      userId: "other",
    }),
  });
  expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(fixture.anna, {
    q: "география",
  });
  expect(page.props.result?.groups[0]?.items[0]?.title).toBe(
    "Политическая география",
  );
});

it("страница передаёт English из серверной настройки, а ошибку длины — кодом", async () => {
  mocks.language.mockResolvedValue("en");
  const page = await Page({ searchParams: Promise.resolve({ q: "а" }) });
  expect(page.props.language).toBe("en");
  expect(page.props.validation).toBe("queryLength");
  expect(fixture.grades.calls).toEqual([]);
});
