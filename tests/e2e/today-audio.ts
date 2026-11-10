import type { Page } from "@playwright/test";

declare global {
  interface Window {
    todayAudio: {
      starts: number;
      stops: number;
      closed: number;
      finish(): void;
      violations: string[];
    };
  }
}
export async function installTodayAudio(page: Page) {
  await page.addInitScript(() => {
    let pending: { onended: (() => void) | null } | null = null;
    window.todayAudio = {
      starts: 0,
      stops: 0,
      closed: 0,
      violations: [],
      finish() {
        pending?.onended?.();
        pending = null;
      },
    };
    document.addEventListener("securitypolicyviolation", (event) =>
      window.todayAudio.violations.push(event.violatedDirective),
    );
    class Context {
      destination = {};
      async resume() {}
      async close() {
        window.todayAudio.closed++;
      }
      async decodeAudioData(value: ArrayBuffer) {
        if (!value.byteLength) throw new Error("empty");
        return {};
      }
      createBufferSource() {
        const source = {
          buffer: null,
          onended: null as (() => void) | null,
          connect() {},
          disconnect() {},
          start() {
            pending = source;
            window.todayAudio.starts++;
          },
          stop() {
            window.todayAudio.stops++;
            source.onended?.();
          },
        };
        return source;
      }
    }
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: Context,
    });
  });
}
