import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { createDatabase } from "@/infrastructure/db/client";
import { briefingSpokenText } from "@/ui/today/briefing-text";
import { expect, test } from "../security/student-login";

declare global {
  interface Window {
    todayEnglishSpeech: {
      calls: { text: string; lang: string; voice: string | null }[];
      cancelled: number;
      finish(): void;
      finishCancelled(): void;
      english(available: boolean): void;
    };
  }
}

async function signIn(
  page: Page,
  credentials: { login: string; password: string },
) {
  await page.goto("/login");
  await expect(page.getByLabel("Language", { exact: true })).toHaveAttribute(
    "data-language-ready",
    "true",
  );
  await page.getByLabel("Username", { exact: true }).fill(credentials.login);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
}

async function seededMoveForStudent(studentId: string) {
  const sql = createDatabase(1);
  try {
    const changes = await sql<{ course: string; time: string; room: string }[]>`
      select c.title as course, left(ch.new_starts_at::text, 5) as time,
        r.title as room
      from students s
      join schedule_slots sl on sl.group_id = s.group_id
      join schedule_changes ch on ch.slot_id = sl.id
      join courses c on c.id = sl.course_id
      join rooms r on r.id = ch.new_room_id
      where s.id = ${studentId} and ch.seed_key = 'demo:change:anna'`;
    expect(changes).toHaveLength(1);
    const change = changes[0];
    if (!change) throw new Error("Нужен засеянный перенос пары студента.");
    expect(change.time).toBe("13:00");
    expect(change.room).toBe("ДЕМО-102");
    return change;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function installEnglishSpeech(page: Page, english = true) {
  await page.addInitScript((available) => {
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
    let hasEnglish = available;
    const synth = Object.assign(new EventTarget(), {
      getVoices: () => [
        { name: "Тестовый русский голос", lang: "ru-RU" },
        ...(hasEnglish ? [{ name: "Test English voice", lang: "en-GB" }] : []),
      ],
      speak(utterance: Utterance) {
        pending = utterance;
        window.todayEnglishSpeech.calls.push({
          text: utterance.text,
          lang: utterance.lang,
          voice: utterance.voice?.name ?? null,
        });
        utterance.onstart?.();
      },
      cancel() {
        cancelled = pending?.onend ?? null;
        pending = null;
        window.todayEnglishSpeech.cancelled++;
      },
    });
    window.todayEnglishSpeech = {
      calls: [],
      cancelled: 0,
      finish() {
        const end = pending?.onend;
        pending = null;
        end?.();
      },
      finishCancelled() {
        cancelled?.();
      },
      english(value) {
        hasEnglish = value;
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
  }, english);
}

async function expectUnbrokenControls(main: Locator) {
  const controls = main
    .getByRole("button")
    .or(main.locator('a[data-slot="button"]'))
    .filter({ visible: true });
  for (const control of await controls.all()) {
    const label = (await control.textContent())?.trim() ?? "";
    const box = await control.boundingBox();
    expect(box?.width, label).toBeGreaterThanOrEqual(44);
    expect(box?.height, label).toBeGreaterThanOrEqual(44);
    if (label) await expect(control).not.toHaveAttribute("aria-label");
    const metrics = await control.evaluate((element) => {
      const broken: string[] = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest(".sr-only")) continue;
        for (const word of (node.textContent ?? "").matchAll(/[A-Za-z]+/g)) {
          const range = document.createRange();
          range.setStart(node, word.index);
          range.setEnd(node, word.index + word[0].length);
          if (
            [...range.getClientRects()].filter(
              (rect) => rect.width > 0 && rect.height > 0,
            ).length > 1
          )
            broken.push(word[0]);
        }
      }
      const style = getComputedStyle(element);
      return {
        width: element.clientWidth,
        content: element.scrollWidth,
        overflowWrap: style.overflowWrap,
        wordBreak: style.wordBreak,
        broken,
      };
    });
    expect(metrics.content, label).toBeLessThanOrEqual(metrics.width + 1);
    expect(metrics.overflowWrap, label).toBe("normal");
    expect(metrics.wordBreak, label).toBe("normal");
    expect(metrics.broken, label).toEqual([]);
  }
}

test.beforeEach(async ({ context, baseURL }) => {
  if (!baseURL) throw new Error("Нужен адрес приложения.");
  await context.addCookies([
    { name: "pulse-language", value: "en", url: baseURL },
  ]);
});

for (const theme of ["light", "dark"] as const) {
  for (const account of ["anna", "timur"] as const) {
    test(`English Сегодня: ${account}, ${theme}, axe и перенос слов`, async ({
      page,
      students,
    }, info) => {
      await page.setViewportSize(
        info.project.name === "mobile-360"
          ? { width: 360, height: 740 }
          : { width: 1440, height: 900 },
      );
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.addInitScript(
        (value) => localStorage.setItem("pulse-theme", value),
        theme,
      );
      await installEnglishSpeech(page);
      await page.clock.setFixedTime(new Date());
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const student = await students.get(account);
      const move =
        account === "anna"
          ? await seededMoveForStudent(student.actor.studentId)
          : null;
      await signIn(page, student.credentials);
      const main = page.getByRole("main");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      await expect(
        main.getByRole("heading", { name: "Today", exact: true, level: 1 }),
      ).toBeVisible();
      for (const heading of ["Day pulse", "Needs action", "What's next"]) {
        await expect(
          main.getByRole("heading", { name: heading, exact: true }),
        ).toBeVisible();
      }
      const briefing = main.getByTestId("today-briefing");
      await expect(briefing).toHaveAttribute("data-briefing-ready", "true");
      await expect(
        briefing.getByTestId("briefing-phrase").first(),
      ).toBeVisible();
      await expect(
        briefing.getByRole("heading", { name: "Day briefing", exact: true }),
      ).toBeVisible();
      await expect(
        briefing.getByRole("button", { name: "Listen", exact: true }),
      ).toBeEnabled();
      const phrases = briefing.getByTestId("briefing-phrase");
      expect(await phrases.count()).toBeGreaterThanOrEqual(3);
      expect(await phrases.count()).toBeLessThanOrEqual(5);
      await expect(main.getByTestId("today-meta")).toContainText(
        /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/,
      );
      const pulseTime = await main
        .getByTestId("pulse-now")
        .getAttribute("datetime");
      if (!pulseTime) throw new Error("Нужно время обзора.");
      await expect(main.getByTestId("pulse-now")).toHaveText(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/Moscow",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(pulseTime)),
      );
      const firstSteps = main.getByTestId("onboarding-card");
      if (account === "anna") {
        if (!move) throw new Error("Нужен засеянный перенос пары Анны.");
        await expect(main.getByTestId("today-greeting")).toContainText("Анна");
        const change = main.getByTestId("today-change").filter({
          has: page.getByRole("heading", {
            name: `${move.course} · Rescheduled`,
            exact: true,
          }),
        });
        await expect(change).toHaveCount(1);
        await expect(change).toBeVisible();
        await expect(change).toContainText(move.course);
        await expect(change).toContainText(move.time);
        await expect(change).toContainText(move.room);
        await expect(
          main
            .getByTestId("today-action")
            .filter({ hasText: "Иностранный язык" }),
        ).toContainText("at risk");
        await expect(firstSteps).toHaveCount(0);
      } else {
        await expect(main.getByTestId("today-greeting")).toContainText("Тимур");
        await expect(main.getByTestId("today-action").first()).toContainText(
          "Основы маркетинга",
        );
        await expect(firstSteps).toHaveAttribute(
          "data-onboarding-ready",
          "true",
        );
        await expect(
          firstSteps.getByRole("heading", { name: "First steps", exact: true }),
        ).toBeVisible();
        await expect(
          firstSteps.getByRole("link", {
            name: "View your weekly timetable",
            exact: true,
          }),
        ).toBeVisible();
      }
      if (info.project.name === "desktop") {
        await expect(main.getByTestId("today-week")).toBeVisible();
        await expect(main.getByTestId("today-week-day")).toHaveCount(6);
        for (const day of await main.getByTestId("today-week-day").all())
          await expect(day).toHaveCSS("hyphens", "manual");
        await expect(main.getByTestId("today-requests")).toBeVisible();
        await expect(main.getByTestId("today-assistant")).toBeVisible();
      }
      await page.evaluate(() => document.fonts.ready);
      await expectUnbrokenControls(main);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      expect(errors).toEqual([]);
      const path = info.outputPath(`today-en-${account}-${theme}.png`);
      await page.screenshot({ path, fullPage: true, animations: "disabled" });
      await info.attach(`Сегодня English: ${account}, ${theme}`, {
        path,
        contentType: "image/png",
      });
    });
  }
}

test("English сводка выбирает английский голос среди русского и читает только по нажатию", async ({
  page,
  students,
}) => {
  await installEnglishSpeech(page);
  await page.clock.setFixedTime(new Date());
  await signIn(page, (await students.get("anna")).credentials);
  const card = page.getByTestId("today-briefing");
  await expect(card).toHaveAttribute("data-briefing-ready", "true");
  await expect(card.getByTestId("briefing-phrase").first()).toBeVisible();
  const listen = card.getByRole("button", { name: "Listen", exact: true });
  await expect(listen).toBeEnabled();
  const phrases = await card.getByTestId("briefing-phrase").allTextContents();
  expect(phrases.length).toBeGreaterThanOrEqual(3);
  expect(phrases.length).toBeLessThanOrEqual(5);
  expect(await page.evaluate(() => window.todayEnglishSpeech.calls)).toEqual(
    [],
  );
  await listen.focus();
  await page.keyboard.press("Enter");
  await expect(card.getByTestId("briefing-status")).toHaveText(
    `Reading phrase 1 of ${phrases.length}.`,
  );
  for (let index = 0; index < phrases.length; index++) {
    await expect(card.locator('[data-speaking="true"]')).toHaveText(
      phrases[index] ?? "",
    );
    await page.evaluate(() => window.todayEnglishSpeech.finish());
  }
  await expect(card.getByTestId("briefing-status")).toHaveText(
    "Briefing finished.",
  );
  expect(await page.evaluate(() => window.todayEnglishSpeech.calls)).toEqual(
    phrases.map((text) => ({
      text: briefingSpokenText(text, "en"),
      lang: "en-GB",
      voice: "Test English voice",
    })),
  );
  await listen.click();
  await card.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(card.getByTestId("briefing-status")).toHaveText(
    "Reading stopped.",
  );
  await page.evaluate(() => window.todayEnglishSpeech.finishCancelled());
  expect(
    await page.evaluate(() => window.todayEnglishSpeech.calls.length),
  ).toBe(phrases.length + 1);
});

test("English без английского голоса объясняет Listen и реагирует на смену голосов", async ({
  page,
  students,
}) => {
  await installEnglishSpeech(page, false);
  await page.clock.setFixedTime(new Date());
  await signIn(page, (await students.get("timur")).credentials);
  const card = page.getByTestId("today-briefing");
  await expect(card).toHaveAttribute("data-briefing-ready", "true");
  await expect(card.getByTestId("briefing-phrase").first()).toBeVisible();
  const listen = card.getByRole("button", { name: "Listen", exact: true });
  const explanation =
    "An English voice is not available. You can read the briefing.";
  await expect(listen).toBeDisabled();
  await expect(listen).toHaveAccessibleDescription(explanation);
  await expect(card.getByText(explanation, { exact: true })).toBeVisible();
  await expect(card.getByTestId("briefing-phrase").first()).toBeVisible();
  expect(await page.evaluate(() => window.todayEnglishSpeech.calls)).toEqual(
    [],
  );
  await page.evaluate(() => window.todayEnglishSpeech.english(true));
  await expect(listen).toBeEnabled();
  await listen.click();
  await page.evaluate(() => window.todayEnglishSpeech.english(false));
  await expect(listen).toBeDisabled();
  await expect(card.getByText(explanation, { exact: true })).toBeVisible();
  await page.evaluate(() => window.todayEnglishSpeech.finishCancelled());
  expect(
    await page.evaluate(() => window.todayEnglishSpeech.calls),
  ).toHaveLength(1);
  expect(await page.evaluate(() => window.todayEnglishSpeech.cancelled)).toBe(
    1,
  );
});
