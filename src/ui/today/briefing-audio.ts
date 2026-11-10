import { briefingMessages } from "@/ui/i18n/dictionaries/today";
import { t } from "@/ui/i18n/translate";
import { appPath } from "@/ui/shared/app-path.mjs";
import type { BriefingPhrase } from "./briefing";
import type { BriefingSpeechState } from "./briefing-speech";

export async function phraseChecksum(text: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export interface BriefingAudioOutput {
  prepare(): Promise<void>;
  play(audio: ArrayBuffer, signal: AbortSignal): Promise<void>;
  stop(): void;
}

export function createWebAudioOutput(): BriefingAudioOutput {
  let context: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  return {
    async prepare() {
      context ??= new AudioContext();
      await context.resume();
    },
    async play(audio, signal) {
      if (!context || signal.aborted) throw new Error("SPEECH_CANCELLED");
      const buffer = await context.decodeAudioData(audio);
      if (signal.aborted) throw new Error("SPEECH_CANCELLED");
      const node = context.createBufferSource();
      source = node;
      node.buffer = buffer;
      node.connect(context.destination);
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          node.stop();
          reject(new Error("SPEECH_CANCELLED"));
        };
        signal.addEventListener("abort", abort, { once: true });
        node.onended = () => {
          signal.removeEventListener("abort", abort);
          node.disconnect();
          if (source === node) source = null;
          resolve();
        };
        node.start();
      });
    },
    stop() {
      if (source) {
        source.stop();
        source.disconnect();
        source = null;
      }
      if (context) {
        void context
          .close()
          .catch(() => console.warn("BRIEFING_AUDIO_CLOSE_FAILED"));
        context = null;
      }
    },
  };
}

export function createBriefingAudioReader(
  output: BriefingAudioOutput,
  update: (state: BriefingSpeechState) => void,
  fallback: (index: number) => boolean,
  request: typeof fetch = fetch,
  timeoutMs = 10_000,
) {
  let controller: AbortController | null = null;
  let text = "";
  function cancel() {
    controller?.abort();
    controller = null;
    output.stop();
  }
  function stop(status = t("ru", briefingMessages, "stopped")) {
    cancel();
    update({ current: null, status });
  }
  async function listen(phrases: readonly BriefingPhrase[]) {
    cancel();
    const run = new AbortController();
    controller = run;
    text = phrases.map((phrase) => phrase.visible).join("\n");
    let index = 0;
    let serverAvailable = true;
    try {
      // Unlock audio inside the click gesture, before the first network await.
      update({
        current: 0,
        status: t("ru", briefingMessages, "reading", {
          current: 1,
          total: phrases.length,
        }),
      });
      await output.prepare();
      for (; index < phrases.length; index++) {
        if (run.signal.aborted) return;
        const phrase = phrases[index];
        if (!phrase) return;
        update({
          current: index,
          status: t("ru", briefingMessages, "reading", {
            current: index + 1,
            total: phrases.length,
          }),
        });
        const pending = new AbortController();
        const abort = () => pending.abort();
        run.signal.addEventListener("abort", abort, { once: true });
        const timer = setTimeout(abort, timeoutMs);
        let response: Response | undefined;
        let audio: ArrayBuffer;
        try {
          const checksum = await phraseChecksum(phrase.visible);
          if (run.signal.aborted) return;
          response = await request(
            appPath(`/api/me/briefing/${index}?checksum=${checksum}`),
            {
              method: "GET",
              cache: "no-store",
              credentials: "same-origin",
              signal: pending.signal,
              headers: { Accept: "audio/wav" },
            },
          );
          if (response.status === 409) {
            stop(t("ru", briefingMessages, "updated"));
            return;
          }
          // Do not speak retained student data after a session has ended or changed role.
          if (response.status === 401 || response.status === 403) {
            serverAvailable = false;
            throw new Error("SPEECH_FORBIDDEN");
          }
          if (
            !response.ok ||
            response.headers.get("Content-Type")?.split(";", 1)[0] !==
              "audio/wav"
          )
            throw new Error("SPEECH_UNAVAILABLE");
          const reader = response.body?.getReader();
          if (!reader) throw new Error("SPEECH_EMPTY");
          const chunks: Uint8Array[] = [];
          let size = 0;
          let done = false;
          try {
            while (true) {
              const part = await reader.read();
              if (part.done) {
                done = true;
                break;
              }
              size += part.value.byteLength;
              if (size > 4 * 1024 * 1024) throw new Error("SPEECH_TOO_LARGE");
              chunks.push(part.value);
            }
          } finally {
            if (!done) await reader.cancel();
            reader.releaseLock();
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          audio = bytes.buffer;
        } finally {
          clearTimeout(timer);
          run.signal.removeEventListener("abort", abort);
          if (response?.body && !response.bodyUsed)
            await response.body.cancel();
          pending.abort();
        }
        if (run.signal.aborted) return;
        await output.play(audio, run.signal);
      }
      if (!run.signal.aborted) stop(t("ru", briefingMessages, "finished"));
    } catch {
      if (run.signal.aborted) return;
      cancel();
      if (serverAvailable && fallback(index)) return;
      update({
        current: null,
        status: t("ru", briefingMessages, "speechError"),
      });
    }
  }
  return {
    listen,
    stop,
    cancel,
    get reading() {
      return controller !== null;
    },
    get text() {
      return text;
    },
  };
}
