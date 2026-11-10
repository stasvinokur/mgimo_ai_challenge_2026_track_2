import { createHash } from "node:crypto";
import type {
  SpeechAudio,
  SpeechSynthesizer,
} from "@/application/ports/speech-synthesizer";

export const MAX_SPEECH_BYTES = 4 * 1024 * 1024;
export const SPEECH_TIMEOUT_MS = 8000;

export type SpeechVoice = "aidar" | "xenia";
type VoicedSpeechSynthesizer = SpeechSynthesizer & {
  readonly voice: SpeechVoice;
};

export class DisabledSpeechSynthesizer implements SpeechSynthesizer {
  readonly enabled = false;
  readonly voice = "aidar";
  async synthesize(): Promise<SpeechAudio> {
    throw new Error("TTS_DISABLED");
  }
}

export class HttpSpeechSynthesizer implements SpeechSynthesizer {
  readonly enabled = true;
  readonly voice = "aidar";
  constructor(
    private readonly url: string,
    private readonly timeoutMs = SPEECH_TIMEOUT_MS,
    private readonly maxBytes = MAX_SPEECH_BYTES,
  ) {}

  async synthesize(text: string): Promise<SpeechAudio> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response | undefined;
    try {
      response = await fetch(new URL("/synthesize", this.url), {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Accept: "audio/wav" },
        body: JSON.stringify({ text, voice: this.voice }),
      });
      if (
        !response.ok ||
        response.headers.get("Content-Type")?.split(";", 1)[0]?.trim() !==
          "audio/wav"
      )
        throw new Error("TTS_RESPONSE_INVALID");
      if (Number(response.headers.get("Content-Length")) > this.maxBytes)
        throw new Error("TTS_RESPONSE_TOO_LARGE");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("TTS_RESPONSE_EMPTY");
      const chunks: Uint8Array[] = [];
      let size = 0;
      let finished = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            finished = true;
            break;
          }
          size += value.byteLength;
          if (size > this.maxBytes) throw new Error("TTS_RESPONSE_TOO_LARGE");
          chunks.push(value);
        }
      } finally {
        if (!finished) await reader.cancel();
        reader.releaseLock();
      }
      const audio = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        audio.set(chunk, offset);
        offset += chunk.length;
      }
      if (
        size < 44 ||
        new TextDecoder().decode(audio.slice(0, 4)) !== "RIFF" ||
        new TextDecoder().decode(audio.slice(8, 12)) !== "WAVE"
      )
        throw new Error("TTS_WAV_INVALID");
      return { audio, contentType: "audio/wav" };
    } catch (error) {
      if (controller.signal.aborted) throw new Error("TTS_TIMEOUT");
      throw error;
    } finally {
      clearTimeout(timer);
      try {
        if (response?.body && !response.bodyUsed && !controller.signal.aborted)
          await response.body.cancel();
      } finally {
        controller.abort();
      }
    }
  }
}

export class CachedSpeechSynthesizer implements SpeechSynthesizer {
  private readonly cache = new Map<
    string,
    { value: SpeechAudio; expires: number }
  >();
  private bytes = 0;
  private readonly pending = new Map<string, Promise<void>>();
  constructor(
    private readonly source: VoicedSpeechSynthesizer,
    private readonly maxBytes = 16 * 1024 * 1024,
    private readonly ttlMs = 60_000,
    private readonly now = Date.now,
  ) {}
  get enabled() {
    return this.source.enabled;
  }
  private remove(key: string) {
    const entry = this.cache.get(key);
    if (entry) this.bytes -= entry.value.audio.byteLength;
    this.cache.delete(key);
  }
  synthesize(text: string) {
    return this.getOrSynthesize(text, async () => {});
  }
  async getOrSynthesize(
    text: string,
    beforeSynthesis: () => Promise<void>,
  ): Promise<SpeechAudio> {
    const key = createHash("sha256")
      .update(`${this.source.voice}\0`)
      .update(text)
      .digest("hex");
    for (const [stored, entry] of this.cache)
      if (entry.expires <= this.now()) this.remove(stored);
    const hit = this.cache.get(key);
    if (hit) return hit.value;
    const previous = this.pending.get(key);
    if (previous) {
      await previous;
      return this.getOrSynthesize(text, beforeSynthesis);
    }
    if (this.pending.size >= 64) throw new Error("TTS_BUSY");
    let release = () => {};
    this.pending.set(
      key,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    try {
      await beforeSynthesis();
      const value = await this.source.synthesize(text);
      this.remove(key);
      if (value.audio.byteLength <= this.maxBytes) {
        while (
          this.bytes + value.audio.byteLength > this.maxBytes ||
          this.cache.size >= 64
        ) {
          const oldest = this.cache.keys().next().value;
          if (oldest === undefined) break;
          this.remove(oldest);
        }
        this.cache.set(key, { value, expires: this.now() + this.ttlMs });
        this.bytes += value.audio.byteLength;
      }
      return value;
    } finally {
      this.pending.delete(key);
      release();
    }
  }
}
