import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSuggestions, isPaletteShortcut } from "@/ui/search/suggestions";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const answer = (query: string) => Response.json({ query, groups: [] });

it("200 мс объединяют ввод, короткий/длинный запрос не отправляется", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(answer("геогр"));
  const publish = vi.fn();
  const client = createSuggestions(publish, fetcher);
  for (const q of ["г", "г".repeat(81), "  "]) client.search(q);
  await vi.advanceTimersByTimeAsync(300);
  expect(fetcher).not.toHaveBeenCalled();
  client.search("ге");
  await vi.advanceTimersByTimeAsync(199);
  client.search("  геогр  ");
  await vi.advanceTimersByTimeAsync(199);
  expect(fetcher).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    "/api/search/suggest?q=%D0%B3%D0%B5%D0%BE%D0%B3%D1%80",
    expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
  );
  expect(publish).toHaveBeenLastCalledWith({
    status: "ready",
    result: { query: "геогр", groups: [] },
  });
});

it("новый ответ остаётся последним, даже если fetch игнорирует abort; старое тело прочитано", async () => {
  const old = Promise.withResolvers<Response>();
  const latest = Promise.withResolvers<Response>();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(latest.promise);
  const publish = vi.fn();
  const client = createSuggestions(publish, fetcher);
  client.search("ге");
  await vi.advanceTimersByTimeAsync(200);
  const signal = fetcher.mock.calls[0]?.[1]?.signal;
  client.search("геогр");
  expect(signal?.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(200);
  latest.resolve(answer("геогр"));
  await vi.advanceTimersByTimeAsync(0);
  const calls = publish.mock.calls.length;
  const response = answer("ге");
  old.resolve(response);
  await vi.advanceTimersByTimeAsync(0);
  expect(response.bodyUsed).toBe(true);
  expect(publish).toHaveBeenCalledTimes(calls);
  expect(publish).toHaveBeenLastCalledWith({
    status: "ready",
    result: { query: "геогр", groups: [] },
  });
});

it("поколение проверяется после чтения тела, а не только заголовков", async () => {
  const body = Promise.withResolvers<string>();
  const old = answer("ге");
  vi.spyOn(old, "text").mockReturnValue(body.promise);
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(old)
    .mockResolvedValueOnce(answer("новый"));
  const publish = vi.fn();
  const client = createSuggestions(publish, fetcher);
  client.search("ге");
  await vi.advanceTimersByTimeAsync(200);
  client.search("новый");
  await vi.advanceTimersByTimeAsync(200);
  const calls = publish.mock.calls.length;
  body.resolve(JSON.stringify({ query: "ге", groups: [] }));
  await vi.advanceTimersByTimeAsync(0);
  expect(publish).toHaveBeenCalledTimes(calls);
});

it.each(["cancel", "short", "error"])(
  "%s отсекает запоздалый результат и ошибку",
  async (mode) => {
    const old = Promise.withResolvers<Response>();
    const publish = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockReturnValue(old.promise);
    const client = createSuggestions(publish, fetcher);
    client.search("ге");
    await vi.advanceTimersByTimeAsync(200);
    if (mode === "short") client.search("г");
    else client.cancel();
    const calls = publish.mock.calls.length;
    if (mode === "error") old.reject(new Error("offline"));
    else old.resolve(answer("ге"));
    await vi.advanceTimersByTimeAsync(0);
    expect(publish).toHaveBeenCalledTimes(calls);
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  },
);

it("закрытие до задержки не отправляет запрос", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const client = createSuggestions(vi.fn(), fetcher);
  client.search("ге");
  client.cancel();
  await vi.advanceTimersByTimeAsync(200);
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([400, 401, 403, 429, 500])(
  "ошибка HTTP %s не оставляет тело непрочитанным",
  async (status) => {
    const response = new Response("Ошибка", { status });
    const publish = vi.fn();
    const client = createSuggestions(
      publish,
      vi.fn<typeof fetch>().mockResolvedValue(response),
    );
    client.search("ге");
    await vi.advanceTimersByTimeAsync(200);
    expect(response.bodyUsed).toBe(true);
    expect(publish).toHaveBeenLastCalledWith({ status: "error" });
  },
);

it("ошибки сети, JSON и чтения тела показывают повтор", async () => {
  const badBody = answer("ге");
  vi.spyOn(badBody, "text").mockRejectedValue(new Error("disconnected"));
  const publish = vi.fn();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(new Response("{broken"))
    .mockResolvedValueOnce(badBody);
  const client = createSuggestions(publish, fetcher);
  for (let i = 0; i < 3; i++) {
    client.search("ге");
    await vi.advanceTimersByTimeAsync(200);
    expect(publish).toHaveBeenLastCalledWith({ status: "error" });
  }
});

it("горячая клавиша принимает только Cmd/Ctrl+K без других модификаторов и IME", () => {
  const event = {
    key: "k",
    code: "KeyK",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
  };
  expect(isPaletteShortcut(event)).toBe(false);
  expect(isPaletteShortcut({ ...event, metaKey: true })).toBe(true);
  expect(isPaletteShortcut({ ...event, ctrlKey: true })).toBe(true);
  for (const field of ["altKey", "shiftKey", "isComposing"])
    expect(isPaletteShortcut({ ...event, metaKey: true, [field]: true })).toBe(
      false,
    );
});

it.each([
  "javascript:alert(1)",
  "https://evil.example",
  "//evil.example",
  "/\\evil.example",
  "/\u0009/evil.example",
])("небезопасный href %s из JSON не попадает в UI", async (href) => {
  const publish = vi.fn();
  const response = Response.json({
    query: "ге",
    groups: [{ items: [{ href }] }],
  });
  const client = createSuggestions(
    publish,
    vi.fn<typeof fetch>().mockResolvedValue(response),
  );
  client.search("ге");
  await vi.advanceTimersByTimeAsync(200);
  expect(response.bodyUsed).toBe(true);
  expect(publish).toHaveBeenLastCalledWith({ status: "error" });
});

it("безопасный внутренний href из JSON принимается", async () => {
  const result = {
    query: "ге",
    groups: [{ items: [{ href: "/schedule?view=week" }] }],
  };
  const publish = vi.fn();
  const client = createSuggestions(
    publish,
    vi.fn<typeof fetch>().mockResolvedValue(Response.json(result)),
  );
  client.search("ге");
  await vi.advanceTimersByTimeAsync(200);
  expect(publish).toHaveBeenLastCalledWith({ status: "ready", result });
});

it("физическая KeyK срабатывает при русской раскладке, соседняя клавиша — нет", () => {
  const event = {
    key: "л",
    code: "KeyK",
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
  };
  expect(isPaletteShortcut(event)).toBe(true);
  expect(isPaletteShortcut({ ...event, metaKey: false, ctrlKey: true })).toBe(
    true,
  );
  expect(isPaletteShortcut({ ...event, code: "KeyL" })).toBe(false);
});
