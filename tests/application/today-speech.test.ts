import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from "@/application/shared/errors";
import {
  BriefingAudioUnavailable,
  GetBriefingAudio,
  SPEECH_PAIR_LIMIT,
  SPEECH_USER_LIMIT,
} from "@/application/today/briefing-audio";
import { buildTodayBriefingForms } from "@/ui/today/briefing";
import { FakeRateLimiter, marina } from "../fakes/identity";
import { todayFixture } from "../fakes/today";

function fixture(enabled = true) {
  const d = todayFixture();
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  let variation = 0;
  const cached = new Map<
    string,
    Promise<{ audio: Uint8Array; contentType: "audio/wav" }>
  >();
  const synthesizer = {
    enabled,
    synthesize: vi.fn(async (_text: string) => ({
      audio: new Uint8Array(44),
      contentType: "audio/wav" as const,
    })),
    async getOrSynthesize(text: string, beforeSynthesis: () => Promise<void>) {
      let result = cached.get(text);
      if (!result) {
        result = Promise.resolve().then(async () => {
          await beforeSynthesis();
          return synthesizer.synthesize(text);
        });
        cached.set(text, result);
      }
      try {
        return await result;
      } catch (error) {
        cached.delete(text);
        throw error;
      }
    },
  };
  const limiter = new FakeRateLimiter(d.clock);
  const build = (data: Parameters<typeof buildTodayBriefingForms>[0]) =>
    buildTodayBriefingForms(data, data.asOf).map((phrase) => ({
      ...phrase,
      spoken: phrase.spoken + (variation ? ` ${"а".repeat(variation)}` : ""),
    }));
  const useCase = new GetBriefingAudio(
    d.overview,
    build,
    synthesizer,
    limiter,
    hash,
  );
  async function input(actor = d.anna) {
    const phrases = build(await d.overview.execute(actor));
    const index = phrases.findIndex((phrase) =>
      phrase.visible.startsWith("Главное:"),
    );
    const phrase = phrases[index];
    if (!phrase) throw new Error("Нужна фраза");
    return { index, checksum: hash(phrase.visible), ip: "192.0.2.1" };
  }
  return {
    ...d,
    useCase,
    synthesizer,
    limiter,
    input,
    hash,
    vary(value: number) {
      variation = value;
    },
  };
}
it("синтезирует только серверную фразу текущего студента", async () => {
  const d = fixture();
  const input = await d.input();
  await d.useCase.execute(d.anna, input);
  expect(d.synthesizer.synthesize).toHaveBeenCalledOnce();
  expect(d.synthesizer.synthesize.mock.calls[0]).not.toMatchObject([
    expect.stringContaining("МСК"),
  ]);
  const foreign = await d.input(d.timur);
  await expect(d.useCase.execute(d.anna, foreign)).rejects.toBeInstanceOf(
    ConflictError,
  );
  expect(d.synthesizer.synthesize).toHaveBeenCalledOnce();
});
it("роль проверяется в use case, индекс вне списка — 404", async () => {
  const d = fixture();
  for (const actor of [
    marina,
    { kind: "teacher", userId: "teacher", teacherId: "teacher" } as const,
  ])
    await expect(
      d.useCase.execute(actor, { index: 0, checksum: "", ip: "" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  for (const index of [-1, 1.5, 5, NaN])
    await expect(
      d.useCase.execute(d.anna, { index, checksum: "", ip: "" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  expect(d.synthesizer.synthesize).not.toHaveBeenCalled();
});
it("нет TTS_URL или сбой синтеза даёт доступный запасной путь", async () => {
  const disabled = fixture(false);
  await expect(
    disabled.useCase.execute(disabled.anna, await disabled.input()),
  ).rejects.toBeInstanceOf(BriefingAudioUnavailable);
  expect(disabled.synthesizer.synthesize).not.toHaveBeenCalled();
  const d = fixture();
  d.synthesizer.synthesize.mockRejectedValue(
    new Error("private implementation"),
  );
  await expect(d.useCase.execute(d.anna, await d.input())).rejects.toThrow(
    "Озвучка временно недоступна.",
  );
});
it("один посетитель исчерпывает свою пару, следующий IP продолжает; ключи содержат только хэши", async () => {
  const d = fixture();
  const input = await d.input();
  await Promise.all(
    Array.from({ length: SPEECH_PAIR_LIMIT }, () =>
      d.useCase.execute(d.anna, input),
    ),
  );
  await expect(d.useCase.execute(d.anna, input)).rejects.toBeInstanceOf(
    RateLimitedError,
  );
  await expect(
    d.useCase.execute(d.anna, { ...input, ip: "192.0.2.2" }),
  ).resolves.toHaveProperty("contentType", "audio/wav");
  for (const key of d.limiter.attempts.keys())
    expect(key).toMatch(/^briefing-speech:(pair|user):[a-f0-9]{64}$/);
});
it("общий предохранитель считает только новые синтезы и восстанавливается через минуту", async () => {
  const d = fixture();
  const input = await d.input();
  for (let i = 0; i < SPEECH_USER_LIMIT; i++) {
    d.vary(i);
    await d.useCase.execute(d.anna, {
      ...input,
      ip: `192.0.2.${Math.floor(i / SPEECH_PAIR_LIMIT)}`,
    });
  }
  d.vary(SPEECH_USER_LIMIT);
  await expect(
    d.useCase.execute(d.anna, { ...input, ip: "198.51.100.1" }),
  ).rejects.toBeInstanceOf(RateLimitedError);
  d.clock.advance(61_000);
  await expect(
    d.useCase.execute(d.anna, { ...(await d.input()), ip: "198.51.100.1" }),
  ).resolves.toHaveProperty("audio");
});

it("десять IP с повторениями не расходуют предохранитель следующего посетителя", async () => {
  const d = fixture();
  const input = await d.input();
  for (let visitor = 0; visitor < 10; visitor++) {
    const request = { ...input, ip: `192.0.2.${visitor}` };
    await Promise.all(
      Array.from({ length: SPEECH_PAIR_LIMIT }, () =>
        d.useCase.execute(d.anna, request),
      ),
    );
    await expect(d.useCase.execute(d.anna, request)).rejects.toBeInstanceOf(
      RateLimitedError,
    );
  }
  await expect(
    d.useCase.execute(d.anna, { ...input, ip: "198.51.100.1" }),
  ).resolves.toHaveProperty("contentType", "audio/wav");
  expect(d.synthesizer.synthesize).toHaveBeenCalledOnce();
  expect(
    d.limiter.attempts.get(`briefing-speech:user:${d.hash(d.anna.userId)}`),
  ).toHaveLength(1);
});
it("кривая checksum отклоняется zod до квоты и чтения данных", async () => {
  const d = fixture();
  const input = await d.input();
  d.calls.length = 0;
  for (const checksum of [
    "",
    "a",
    "0".repeat(63),
    "A".repeat(64),
    "g".repeat(64),
    "0".repeat(65),
  ]) {
    await expect(
      d.useCase.execute(d.anna, { ...input, checksum }),
    ).rejects.toBeInstanceOf(ValidationError);
  }
  expect(d.limiter.attempts.size).toBe(0);
  expect(d.calls).toEqual([]);
});
