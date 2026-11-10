import AxeBuilder from "@axe-core/playwright";
import { phraseChecksum } from "@/ui/today/briefing-audio";
import { expect, test } from "../security/student-login";
import { installTodayAudio } from "./today-audio";
import { installTodaySpeech } from "./today-speech";

declare global {
  interface Window {
    todayRealAudioStarts: number;
    todayRealAudioBytes: { size: number; head: string } | null;
  }
}

const serverSpeech = process.env.E2E_TTS === "1";
const wav = Buffer.alloc(48);
wav.write("RIFF", 0);
wav.write("WAVE", 8);
test.describe("Подмена серверного ответа", () => {
  test.use({ serviceWorkers: "block" });
  test("серверный звук без голоса устройства: фразы, Стоп, CSP, axe и 360 px", async ({
    page,
    loginAs,
  }) => {
    test.skip(!serverSpeech, "Нужен включённый TTS_URL и E2E_TTS=1.");
    await installTodaySpeech(page, "no-russian");
    await installTodayAudio(page);
    await page.clock.setFixedTime(new Date());
    const requests: string[] = [];
    await page.route("**/api/me/briefing/*", async (route) => {
      expect(route.request().method()).toBe("GET");
      requests.push(route.request().url());
      await route.fulfill({ status: 200, contentType: "audio/wav", body: wav });
    });
    await loginAs("anna");
    const card = page.getByTestId("today-briefing");
    await expect(card).toHaveAttribute("data-briefing-ready", "true");
    await expect(card.getByTestId("briefing-phrase").first()).toBeVisible();
    const phrases = await card.getByTestId("briefing-phrase").allTextContents();
    expect(phrases.length).toBeGreaterThanOrEqual(3);
    expect(phrases.length).toBeLessThanOrEqual(5);
    await card.getByRole("button", { name: "Послушать", exact: true }).click();
    for (let index = 0; index < phrases.length; index++) {
      await expect
        .poll(() => page.evaluate(() => window.todayAudio.starts))
        .toBe(index + 1);
      await expect(card.locator('[data-speaking="true"]')).toHaveText(
        phrases[index] ?? "",
      );
      expect(new URL(requests[index] ?? "").searchParams.get("checksum")).toBe(
        await phraseChecksum(phrases[index] ?? ""),
      );
      if (index === 0)
        expect(
          (
            await new AxeBuilder({ page })
              .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
              .analyze()
          ).violations,
        ).toEqual([]);
      await page.evaluate(() => window.todayAudio.finish());
    }
    await expect(card.getByTestId("briefing-status")).toHaveText(
      "Сводка прочитана.",
    );
    await card.getByRole("button", { name: "Послушать", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.todayAudio.starts))
      .toBe(phrases.length + 1);
    await card.getByRole("button", { name: "Стоп", exact: true }).click();
    await expect(card.getByTestId("briefing-status")).toHaveText(
      "Чтение остановлено.",
    );
    expect(await page.evaluate(() => window.todayAudio.stops)).toBeGreaterThan(
      0,
    );
    expect(await page.evaluate(() => window.todayAudio.violations)).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
  for (const status of [429, 503, 409])
    test(`серверный ответ ${status}: запасной голос или обновление`, async ({
      page,
      loginAs,
    }) => {
      test.skip(!serverSpeech, "Нужен включённый TTS_URL и E2E_TTS=1.");
      await installTodaySpeech(page);
      await installTodayAudio(page);
      await page.clock.setFixedTime(new Date());
      await page.route("**/api/me/briefing/*", (route) =>
        route.fulfill({ status, body: "{}" }),
      );
      await loginAs("anna");
      const card = page.getByTestId("today-briefing");
      await expect(card).toHaveAttribute("data-briefing-ready", "true");
      await expect(card.getByTestId("briefing-phrase").first()).toBeVisible();
      const first =
        (await card
          .getByTestId("briefing-phrase")
          .first()
          .getAttribute("data-spoken")) ?? "";
      await card
        .getByRole("button", { name: "Послушать", exact: true })
        .click();
      expect(first).not.toBe("");
      if (status === 409) {
        await expect(card.getByTestId("briefing-status")).toContainText(
          "Сводка обновилась",
        );
        expect(await page.evaluate(() => window.todaySpeech.calls)).toEqual([]);
      } else {
        await expect(card.getByTestId("briefing-status")).toContainText(
          "Включён голос устройства",
        );
        expect(
          await page.evaluate(() => window.todaySpeech.calls[0]?.text),
        ).toBe(first);
        expect(
          (
            await new AxeBuilder({ page })
              .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
              .analyze()
          ).violations,
        ).toEqual([]);
      }
    });
  test("pagehide останавливает pending-запрос и запоздалый WAV не играет", async ({
    page,
    loginAs,
  }) => {
    test.skip(!serverSpeech, "Нужен включённый TTS_URL и E2E_TTS=1.");
    await installTodayAudio(page);
    await installTodaySpeech(page);
    let finish: (() => void) | undefined;
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await page.route("**/api/me/briefing/*", async (route) => {
      finish?.();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ status: 200, contentType: "audio/wav", body: wav });
    });
    await loginAs("anna");
    const card = page.getByTestId("today-briefing");
    await expect(card).toHaveAttribute("data-briefing-ready", "true");
    await expect(card.getByTestId("briefing-phrase").first()).toBeVisible();
    await card.getByRole("button", { name: "Послушать", exact: true }).click();
    await pending;
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    release?.();
    await expect(card.getByTestId("briefing-status")).toHaveText(
      "Чтение остановлено.",
    );
    expect(await page.evaluate(() => window.todayAudio.starts)).toBe(0);
  });
});

test.describe("Настоящий синтез и service worker", () => {
  test.use({ serviceWorkers: "allow" });
  test("настоящий Silero: WAV маршрута, воспроизведение и отсутствие аудио в кэшах SW", async ({
    page,
    loginAs,
    context,
  }) => {
    test.skip(!serverSpeech, "Настоящий синтез проверяется при E2E_TTS=1.");
    await installTodaySpeech(page);
    await page.addInitScript(() => {
      window.todayRealAudioStarts = 0;
      window.todayRealAudioBytes = null;
      // The bytes the page decodes: a response served through the service worker may have no body for CDP.
      const decode = BaseAudioContext.prototype.decodeAudioData;
      BaseAudioContext.prototype.decodeAudioData = function (
        this: BaseAudioContext,
        data: ArrayBuffer,
        ...rest: unknown[]
      ) {
        window.todayRealAudioBytes ??= {
          size: data.byteLength,
          head: String.fromCharCode(...new Uint8Array(data, 0, 4)),
        };
        return (decode as (...args: unknown[]) => Promise<AudioBuffer>).call(
          this,
          data,
          ...rest,
        );
      };
      const original = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (
        this: AudioBufferSourceNode,
        ...args: Parameters<typeof original>
      ) {
        window.todayRealAudioStarts++;
        return original.apply(this, args);
      };
    });
    await loginAs("anna");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    if (
      !(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    )
      await page.reload();
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      )
      .toBe(true);
    const card = page.getByTestId("today-briefing");
    await expect(card).toHaveAttribute("data-briefing-ready", "true");
    await expect(card.getByTestId("briefing-phrase").first()).toBeVisible();
    const responsePromise = page.waitForResponse((response) =>
      response.url().includes("/api/me/briefing/0?"),
    );
    await card.getByRole("button", { name: "Послушать", exact: true }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("audio/wav");
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    await expect
      .poll(() => page.evaluate(() => window.todayRealAudioStarts))
      .toBeGreaterThan(0);
    const bytes = await page.evaluate(() => window.todayRealAudioBytes);
    expect(bytes?.head).toBe("RIFF");
    expect(bytes?.size).toBeGreaterThan(4800);
    await expect(card.locator('[data-speaking="true"]')).toHaveCount(1);
    await card.getByRole("button", { name: "Стоп", exact: true }).click();
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys())
        for (const key of await (await caches.open(name)).keys())
          urls.push(key.url);
      return urls;
    });
    expect(cached.filter((url) => url.includes("/api/me/briefing/"))).toEqual(
      [],
    );
    await context.setOffline(true);
    try {
      await card
        .getByRole("button", { name: "Послушать", exact: true })
        .click();
      await expect
        .poll(() => page.evaluate(() => window.todaySpeech.calls.length))
        .toBe(1);
      await expect(card.getByTestId("briefing-status")).toContainText(
        "Читается фраза 1",
      );
    } finally {
      await context.setOffline(false);
    }
  });
});
