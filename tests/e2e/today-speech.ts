import type { Page } from "@playwright/test";

declare global {
  interface Window {
    todaySpeech: {
      calls: { text: string; lang: string; voice: string | null }[];
      cancelCount: number;
      finish(): void;
      finishCancelled(): void;
      fail(): void;
      loadRussian(): void;
      removeRussian(): void;
    };
  }
}

export async function installTodaySpeech(
  page: Page,
  mode: "ready" | "delayed" | "no-russian" | "unsupported" = "ready",
) {
  await page.addInitScript((mode) => {
    if (mode === "unsupported") {
      Object.defineProperty(window, "speechSynthesis", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        configurable: true,
        value: undefined,
      });
      return;
    }
    class Utterance {
      lang = "";
      voice: { name: string } | null = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public text: string) {}
    }
    let pending: Utterance | null = null;
    let cancelled: (() => void) | null = null;
    let russian = mode === "ready";
    const synth = Object.assign(new EventTarget(), {
      getVoices: () =>
        russian
          ? [{ name: "Тестовый русский голос", lang: "ru-RU" }]
          : mode === "delayed"
            ? []
            : [{ name: "English", lang: "en-US" }],
      speak(utterance: Utterance) {
        pending = utterance;
        window.todaySpeech.calls.push({
          text: utterance.text,
          lang: utterance.lang,
          voice: utterance.voice?.name ?? null,
        });
        utterance.onstart?.();
      },
      cancel() {
        cancelled = pending?.onend ?? null;
        pending = null;
        window.todaySpeech.cancelCount++;
        sessionStorage.setItem(
          "today-speech-cancels",
          String(window.todaySpeech.cancelCount),
        );
      },
    });
    window.todaySpeech = {
      calls: [],
      cancelCount: Number(sessionStorage.getItem("today-speech-cancels") ?? 0),
      finish() {
        const end = pending?.onend;
        pending = null;
        end?.();
      },
      finishCancelled() {
        cancelled?.();
      },
      fail() {
        pending?.onerror?.();
      },
      loadRussian() {
        russian = true;
        synth.dispatchEvent(new Event("voiceschanged"));
      },
      removeRussian() {
        russian = false;
        synth.dispatchEvent(new Event("voiceschanged"));
      },
    };
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: synth,
    });
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      configurable: true,
      value: Utterance,
    });
  }, mode);
}
