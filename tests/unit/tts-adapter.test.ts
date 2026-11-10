import { createServer, type ServerResponse } from "node:http";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  CachedSpeechSynthesizer,
  DisabledSpeechSynthesizer,
  HttpSpeechSynthesizer,
  type SpeechVoice,
} from "@/infrastructure/tts/synthesizer";

const wav = new Uint8Array(48);
wav.set(new TextEncoder().encode("RIFF"), 0);
wav.set(new TextEncoder().encode("WAVE"), 8);
let url = "";
let respond: (response: ServerResponse) => void = () => {};
const received: {
  method: string | undefined;
  path: string | undefined;
  payload: unknown;
}[] = [];
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => {
    body += String(chunk);
  });
  request.on("end", () => {
    received.push({
      method: request.method,
      path: request.url,
      payload: JSON.parse(body),
    });
    respond(response);
  });
});
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Нет HTTP-адреса");
  url = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

it("успех: локальный HTTP-сервис отдаёт WAV", async () => {
  respond = (response) => {
    response.writeHead(200, { "Content-Type": "audio/wav" });
    response.end(wav);
  };
  expect(await new HttpSpeechSynthesizer(url).synthesize("Тест.")).toEqual({
    audio: wav,
    contentType: "audio/wav",
  });
  expect(received.at(-1)).toEqual({
    method: "POST",
    path: "/synthesize",
    payload: { text: "Тест.", voice: "aidar" },
  });
});
it.each([
  "5xx",
  "type",
  "size-header",
  "size-stream",
  "invalid-wav",
  "timeout",
  "body-timeout",
] as const)("ограничивает ответ: %s", async (kind) => {
  respond = (response) => {
    if (kind === "timeout") return;
    response.writeHead(kind === "5xx" ? 503 : 200, {
      "Content-Type": kind === "type" ? "text/html" : "audio/wav",
      ...(kind === "size-header" ? { "Content-Length": "200" } : {}),
    });
    if (kind === "body-timeout") {
      response.write(wav);
      return;
    }
    if (kind === "size-stream") {
      response.end(new Uint8Array(200));
      return;
    }
    response.end(kind === "invalid-wav" ? new Uint8Array(48) : wav);
  };
  const codes = {
    "5xx": "TTS_RESPONSE_INVALID",
    type: "TTS_RESPONSE_INVALID",
    "size-header": "TTS_RESPONSE_TOO_LARGE",
    "size-stream": "TTS_RESPONSE_TOO_LARGE",
    "invalid-wav": "TTS_WAV_INVALID",
    timeout: "TTS_TIMEOUT",
    "body-timeout": "TTS_TIMEOUT",
  };
  await expect(
    new HttpSpeechSynthesizer(url, 50, 100).synthesize("Тест."),
  ).rejects.toThrow(codes[kind]);
});
it("выключенный адаптер не обращается к сети", async () => {
  const disabled = new DisabledSpeechSynthesizer();
  expect(disabled.enabled).toBe(false);
  await expect(disabled.synthesize()).rejects.toThrow("TTS_DISABLED");
});
it("кэш ограничен байтами, числом и TTL; ошибка не кэшируется", async () => {
  let now = 0;
  const source = {
    enabled: true,
    voice: "aidar" as const,
    synthesize: vi.fn(async () => ({
      audio: wav,
      contentType: "audio/wav" as const,
    })),
  };
  const cached = new CachedSpeechSynthesizer(source, 96, 100, () => now);
  await cached.synthesize("А");
  await cached.synthesize("А");
  expect(source.synthesize).toHaveBeenCalledTimes(1);
  await cached.synthesize("Б");
  await cached.synthesize("В");
  await cached.synthesize("А");
  expect(source.synthesize).toHaveBeenCalledTimes(4);
  now = 101;
  await cached.synthesize("А");
  expect(source.synthesize).toHaveBeenCalledTimes(5);
  source.synthesize.mockRejectedValueOnce(new Error("TTS_FAILED"));
  await expect(cached.synthesize("Ошибка")).rejects.toThrow("TTS_FAILED");
  await cached.synthesize("Ошибка");
  expect(source.synthesize).toHaveBeenCalledTimes(7);
});

it("одинаковая фраза разными голосами хранится отдельно в кэше", async () => {
  let voice: SpeechVoice = "aidar";
  const source = {
    enabled: true,
    get voice() {
      return voice;
    },
    synthesize: vi.fn(async () => {
      const audio = wav.slice();
      audio[44] = voice === "aidar" ? 1 : 2;
      return { audio, contentType: "audio/wav" as const };
    }),
  };
  const cached = new CachedSpeechSynthesizer(source);
  expect((await cached.synthesize("Та же фраза.")).audio[44]).toBe(1);
  voice = "xenia";
  expect((await cached.synthesize("Та же фраза.")).audio[44]).toBe(2);
  voice = "aidar";
  expect((await cached.synthesize("Та же фраза.")).audio[44]).toBe(1);
  expect(source.synthesize).toHaveBeenCalledTimes(2);
});

it("параллельный промах одной фразы резервирует один настоящий синтез", async () => {
  let finish = () => {};
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const source = {
    enabled: true,
    voice: "aidar" as const,
    synthesize: vi.fn(async () => {
      await pending;
      return { audio: wav, contentType: "audio/wav" as const };
    }),
  };
  const cached = new CachedSpeechSynthesizer(source);
  const before = vi.fn(async () => {});
  const requests = Array.from({ length: 20 }, () =>
    cached.getOrSynthesize("Фраза", before),
  );
  await vi.waitFor(() => expect(source.synthesize).toHaveBeenCalledOnce());
  finish();
  await Promise.all(requests);
  expect(before).toHaveBeenCalledOnce();
});
it("отказ квоты одного пользователя не становится отказом другого на той же фразе", async () => {
  const source = {
    enabled: true,
    voice: "aidar" as const,
    synthesize: vi.fn(async () => ({
      audio: wav,
      contentType: "audio/wav" as const,
    })),
  };
  const cached = new CachedSpeechSynthesizer(source);
  const first = cached.getOrSynthesize("Фраза", async () => {
    throw new Error("LIMIT");
  });
  const second = cached.getOrSynthesize("Фраза", async () => {});
  await expect(first).rejects.toThrow("LIMIT");
  await expect(second).resolves.toHaveProperty("contentType", "audio/wav");
  expect(source.synthesize).toHaveBeenCalledOnce();
});
