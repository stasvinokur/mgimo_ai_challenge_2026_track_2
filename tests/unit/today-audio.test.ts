import { expect, it, vi } from "vitest";
import { isPageSnapshot } from "@/ui/shell/pwa-cache";
import {
  type BriefingAudioOutput,
  createBriefingAudioReader,
} from "@/ui/today/briefing-audio";
import type { BriefingSpeechState } from "@/ui/today/briefing-speech";

const phrases = [
  { visible: "Первая 1.", spoken: "Первая одна." },
  { visible: "Вторая 2.", spoken: "Вторая две." },
];
function fixture(request: typeof fetch) {
  const state: BriefingSpeechState[] = [];
  const ends: (() => void)[] = [];
  const output: BriefingAudioOutput = {
    prepare: vi.fn(async () => {}),
    stop: vi.fn(),
    play: vi.fn(
      (_audio, signal) =>
        new Promise<void>((resolve, reject) => {
          ends.push(resolve);
          signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          );
        }),
    ),
  };
  const fallback = vi.fn(() => true);
  const reader = createBriefingAudioReader(
    output,
    (next) => state.push(next),
    fallback,
    request,
    30,
  );
  return { reader, state, ends, output, fallback };
}
const audio = () =>
  new Response(new Uint8Array(48), {
    headers: { "Content-Type": "audio/wav" },
  });
it("WAV играет по фразам, запросы только GET с checksum и no-store", async () => {
  const request = vi.fn<typeof fetch>(async () => audio());
  const d = fixture(request);
  const pending = d.reader.listen(phrases);
  await vi.waitFor(() => expect(d.output.play).toHaveBeenCalledTimes(1));
  expect(request.mock.calls[0]).toMatchObject([
    expect.stringMatching(/^\/api\/me\/briefing\/0\?checksum=[a-f0-9]{64}$/),
    { method: "GET", cache: "no-store", credentials: "same-origin" },
  ]);
  d.ends[0]?.();
  await vi.waitFor(() => expect(d.output.play).toHaveBeenCalledTimes(2));
  expect(d.state.at(-1)).toEqual({
    current: 1,
    status: "Читается фраза 2 из 2.",
  });
  d.ends[1]?.();
  await pending;
  expect(d.state.at(-1)?.status).toBe("Сводка прочитана.");
  expect(d.fallback).not.toHaveBeenCalled();
});
it.each([429, 503, 500])(
  "HTTP %s продолжает с той же фразы; тело отменено",
  async (status) => {
    const cancel = vi.fn();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(audio())
      .mockResolvedValueOnce(
        new Response(new ReadableStream({ cancel }), { status }),
      );
    const d = fixture(request);
    const pending = d.reader.listen(phrases);
    await vi.waitFor(() => expect(d.output.play).toHaveBeenCalledOnce());
    d.ends[0]?.();
    await pending;
    expect(d.fallback).toHaveBeenCalledExactlyOnceWith(1);
    expect(cancel).toHaveBeenCalledOnce();
  },
);
it("409 сообщает об обновлении, без голоса ошибка видна через статус", async () => {
  const cancel = vi.fn();
  const d = fixture(
    async () => new Response(new ReadableStream({ cancel }), { status: 409 }),
  );
  await d.reader.listen(phrases);
  expect(d.state.at(-1)).toMatchObject({
    current: null,
    status: expect.stringContaining("Сводка обновилась"),
  });
  expect(cancel).toHaveBeenCalledOnce();
  expect(d.fallback).not.toHaveBeenCalled();
  const failed = fixture(async () => {
    throw new TypeError("network");
  });
  failed.fallback.mockReturnValue(false);
  await failed.reader.listen(phrases);
  expect(failed.state.at(-1)?.status).toContain("Не удалось озвучить");
});
it.each([401, 403])(
  "HTTP %s после смены сессии не читает сохранённые данные",
  async (status) => {
    const d = fixture(async () => new Response(null, { status }));
    await d.reader.listen(phrases);
    expect(d.fallback).not.toHaveBeenCalled();
    expect(d.state.at(-1)?.current).toBeNull();
  },
);
it("таймаут запроса включает голос устройства", async () => {
  const d = fixture(
    (_url, options) =>
      new Promise((_resolve, reject) =>
        options?.signal?.addEventListener(
          "abort",
          () => reject(new Error("timeout")),
          { once: true },
        ),
      ),
  );
  await d.reader.listen(phrases);
  expect(d.fallback).toHaveBeenCalledExactlyOnceWith(0);
});
it("Стоп прерывает pending fetch и отсекает запоздалый ответ", async () => {
  let resolve: (response: Response) => void = () => {};
  let signal: AbortSignal | null | undefined;
  const requested = vi.fn();
  const d = fixture((_url, options) => {
    signal = options?.signal;
    requested();
    return new Promise((done) => {
      resolve = done;
    });
  });
  const pending = d.reader.listen(phrases);
  await vi.waitFor(() => expect(requested).toHaveBeenCalled());
  d.reader.stop();
  expect(signal?.aborted).toBe(true);
  resolve(audio());
  await pending;
  expect(d.output.play).not.toHaveBeenCalled();
  expect(d.fallback).not.toHaveBeenCalled();
  expect(d.state.at(-1)).toEqual({
    current: null,
    status: "Чтение остановлено.",
  });
});
it("cancel при pagehide немедленно останавливает звук, окончание не запускает новую фразу", async () => {
  const request = vi.fn<typeof fetch>(async () => audio());
  const d = fixture(request);
  const pending = d.reader.listen(phrases);
  await vi.waitFor(() => expect(d.output.play).toHaveBeenCalledOnce());
  d.reader.cancel();
  d.ends[0]?.();
  await pending;
  expect(request).toHaveBeenCalledOnce();
  expect(d.fallback).not.toHaveBeenCalled();
  expect(d.reader.reading).toBe(false);
});
it("WAV API никогда не является страницей офлайн-кэша", () => {
  const origin = "https://pulse.test";
  for (const accept of ["audio/wav", "text/html"])
    expect(
      isPageSnapshot(
        new Request(`${origin}/api/me/briefing/0?checksum=abc`, {
          headers: { Accept: accept },
        }),
        origin,
      ),
    ).toBe(false);
});
