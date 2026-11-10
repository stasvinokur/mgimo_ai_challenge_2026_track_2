import { expect, type Page, test } from "@playwright/test";
import { gradesMessages } from "@/ui/i18n/dictionaries/grades";
import { notificationsMessages } from "@/ui/i18n/dictionaries/notifications";
import { profileMessages } from "@/ui/i18n/dictionaries/profile";
import { regulationsMessages } from "@/ui/i18n/dictionaries/regulations";
import { requestsMessages } from "@/ui/i18n/dictionaries/requests";
import { scheduleMessages } from "@/ui/i18n/dictionaries/schedule";
import { todayMessages } from "@/ui/i18n/dictionaries/today";
import { loginAs } from "../security/login";
import { captureScreenshot } from "./screenshot";
import { shellPages } from "./shell-cases";

const modes = [
  { name: "large-text", cookies: ["pulse-large-text"] },
  { name: "high-contrast", cookies: ["pulse-high-contrast"] },
  { name: "reduced-motion", cookies: ["pulse-reduced-motion"] },
  {
    name: "all",
    cookies: [
      "pulse-large-text",
      "pulse-high-contrast",
      "pulse-reduced-motion",
    ],
  },
];
const screens = shellPages.filter((screen) =>
  ["/today", "/grades", "/requests", "/staff/requests"].includes(screen.path),
);

for (const theme of ["light", "dark"] as const) {
  for (const mode of modes) {
    test(`${mode.name} · ${theme}: основные экраны, axe и снимки`, async ({
      page,
      context,
      baseURL,
    }, info) => {
      test.setTimeout(120_000);
      if (!baseURL) throw new Error("Нужен адрес приложения.");
      await page.setViewportSize(
        info.project.name === "mobile-360"
          ? { width: 360, height: 740 }
          : { width: 1440, height: 900 },
      );
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript(
        (value) => localStorage.setItem("pulse-theme", value),
        theme,
      );
      await context.addCookies(
        mode.cookies.map((name) => ({ name, value: "on", url: baseURL })),
      );
      await loginAs(page, "anna");
      for (const screen of screens) {
        await test.step(screen.title, async () => {
          if (screen.path.startsWith("/staff/")) await loginAs(page, "marina");
          await page.goto(screen.path);
          await expect(page.locator("html")).toHaveClass(new RegExp(theme));
          for (const cookie of mode.cookies)
            await expect(page.locator("html")).toHaveClass(
              new RegExp(`a11y-${cookie.slice("pulse-".length)}`),
            );
          await expect(
            page.getByRole("heading", {
              level: 1,
              name: screen.title,
              exact: true,
            }),
          ).toBeVisible();
          await page.evaluate(() => document.fonts.ready);

          const controls = page.locator(
            'button, a[data-slot="button"], .nav-link, .header-icon',
          );
          for (const control of await controls.all()) {
            if (!(await control.isVisible())) continue;
            const box = await control.boundingBox();
            const label = (await control.textContent())?.trim() ?? "";
            expect(box?.width, label).toBeGreaterThanOrEqual(44);
            expect(box?.height, label).toBeGreaterThanOrEqual(44);
            const metrics = await control.evaluate((element) => {
              const brokenWords: string[] = [];
              const walker = document.createTreeWalker(
                element,
                NodeFilter.SHOW_TEXT,
              );
              for (
                let node = walker.nextNode();
                node;
                node = walker.nextNode()
              ) {
                if (node.parentElement?.closest(".sr-only")) continue;
                for (const match of (node.textContent ?? "").matchAll(
                  /[A-Za-zА-Яа-яЁё]+/g,
                )) {
                  const range = document.createRange();
                  range.setStart(node, match.index);
                  range.setEnd(node, match.index + match[0].length);
                  const lines = [...range.getClientRects()].filter(
                    (rect) => rect.width > 0 && rect.height > 0,
                  );
                  if (lines.length > 1) brokenWords.push(match[0]);
                }
              }
              return {
                width: element.clientWidth,
                content: element.scrollWidth,
                brokenWords,
              };
            });
            expect(metrics.content, label).toBeLessThanOrEqual(
              metrics.width + 1,
            );
            expect(metrics.brokenWords, label).toEqual([]);
          }
          if (info.project.name === "mobile-360") {
            const navigation = page.locator(".mobile-navigation");
            await expect(navigation).toBeVisible();
            for (const label of await navigation
              .locator(".nav-link > span")
              .all()) {
              const metrics = await label.evaluate((element) => ({
                width: element.getBoundingClientRect().width,
                available:
                  element.parentElement?.getBoundingClientRect().width ?? 0,
                height: element.getBoundingClientRect().height,
                lineHeight: Number.parseFloat(
                  getComputedStyle(element).lineHeight,
                ),
              }));
              expect(metrics.width).toBeLessThanOrEqual(
                metrics.available + 0.5,
              );
              expect(metrics.height).toBeLessThanOrEqual(
                metrics.lineHeight + 0.5,
              );
            }
          }
          await captureScreenshot(
            page,
            info.outputPath(
              `${screen.path.slice(1).replaceAll("/", "-")}-${mode.name}-${theme}.png`,
            ),
            { fullPage: true },
          );
        });
      }
    });
  }
}

async function expectWholeHeadingWords(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('div[hidden][id^="S:"]')).toHaveCount(0);
  const headings = page.locator("main h1:visible, main .text-display:visible");
  await expect(headings).not.toHaveCount(0);
  for (const heading of await headings.all()) {
    const metrics = await heading.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const words: { text: string; rects: number }[] = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest(".sr-only, [aria-hidden='true']"))
          continue;
        for (const match of (node.textContent ?? "").matchAll(
          /[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)*/gu,
        )) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          words.push({
            text: match[0],
            rects: [...range.getClientRects()].filter(
              (rect) => rect.width > 0 && rect.height > 0,
            ).length,
          });
        }
      }
      return {
        label: element.textContent?.trim() ?? "",
        width: element.clientWidth,
        content: element.scrollWidth,
        left: box.left,
        right: box.right,
        words,
      };
    });
    expect(metrics.words.length, metrics.label).toBeGreaterThan(0);
    for (const word of metrics.words)
      expect(word.rects, `${metrics.label}: ${word.text}`).toBe(1);
    expect(metrics.content, metrics.label).toBeLessThanOrEqual(
      metrics.width + 1,
    );
    expect(metrics.left, metrics.label).toBeGreaterThanOrEqual(0);
    expect(metrics.right, metrics.label).toBeLessThanOrEqual(360);
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
}

for (const language of ["ru", "en"] as const) {
  test(`Крупный текст на 360 px: целые слова заголовков · ${language}`, async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    if (!baseURL) throw new Error("Нужен адрес приложения.");
    await page.setViewportSize({ width: 360, height: 740 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript(() =>
      localStorage.setItem("pulse-theme", "light"),
    );
    await loginAs(page, "anna");
    await context.addCookies([
      { name: "pulse-large-text", value: "on", url: baseURL },
      { name: "pulse-language", value: language, url: baseURL },
    ]);
    const routes = [
      { path: "/today", title: todayMessages.today[language] },
      { path: "/schedule", title: scheduleMessages.title[language] },
      { path: "/grades", title: gradesMessages.study[language] },
      { path: "/requests", title: requestsMessages.requests[language] },
      { path: "/requests/new", title: requestsMessages.newRequest[language] },
      { path: "/notifications", title: notificationsMessages.title[language] },
      { path: "/profile", title: profileMessages.title[language] },
      {
        path: "/regulations",
        title: regulationsMessages.catalogTitle[language],
      },
    ];
    for (const route of routes) {
      await test.step(route.path, async () => {
        await page.goto(route.path);
        await expect(page.locator("html")).toHaveAttribute("lang", language);
        await expect(page.locator("html")).toHaveClass(/\ba11y-large-text\b/);
        await expect(
          page.getByRole("heading", {
            level: 1,
            name: route.title,
            exact: true,
          }),
        ).toBeVisible();
        await expectWholeHeadingWords(page);
        if (route.path === "/today") {
          const pulse = page.getByTestId("pulse-state");
          await expect(pulse).toBeVisible();
          const sizes = await pulse.evaluate((element) => {
            const root = document.documentElement;
            const read = () => ({
              root: Number.parseFloat(getComputedStyle(root).fontSize),
              body: Number.parseFloat(getComputedStyle(document.body).fontSize),
              heading: Number.parseFloat(getComputedStyle(element).fontSize),
            });
            const large = read();
            root.classList.remove("a11y-large-text");
            const ordinary = read();
            root.classList.add("a11y-large-text");
            return { large, ordinary };
          });
          expect(sizes.large.root / sizes.ordinary.root).toBeCloseTo(1.25, 2);
          expect(sizes.large.body / sizes.ordinary.body).toBeCloseTo(1.25, 2);
          expect(sizes.large.heading).toBeGreaterThanOrEqual(
            sizes.ordinary.heading,
          );
          expect(sizes.large.heading).toBeLessThanOrEqual(
            sizes.ordinary.heading * 1.25,
          );
          // Exercise every server-selected label in the real card without changing the schedule.
          await pulse.evaluate((element) => {
            const probe = element.cloneNode(false) as HTMLElement;
            probe.removeAttribute("data-testid");
            probe.id = "settings-pulse-state-probe";
            element.after(probe);
          });
          const probe = page.locator("#settings-pulse-state-probe");
          for (const state of [
            "noClasses",
            "ongoing",
            "classesEnded",
          ] as const) {
            await probe.evaluate((element, text) => {
              element.textContent = text;
            }, todayMessages[state][language]);
            await expect(probe).toHaveText(todayMessages[state][language]);
            await expectWholeHeadingWords(page);
          }
          await probe.evaluate((element) => element.remove());
        }
        if (route.path === "/grades") {
          const links = page
            .getByTestId("grade-course")
            .locator('a[href^="/grades/"]');
          await expect(links.first()).toBeVisible();
          const paths = await links.evaluateAll((elements) => [
            ...new Set(elements.map((element) => element.getAttribute("href"))),
          ]);
          expect(paths.length).toBeGreaterThan(0);
          for (const path of paths) {
            if (!path) throw new Error("Нужна ссылка на дисциплину.");
            await test.step(path, async () => {
              await page.goto(path);
              await expect(
                page.getByRole("heading", { level: 1 }),
              ).toBeVisible();
              await expect(page.getByTestId("grade-course")).toBeVisible();
              await expectWholeHeadingWords(page);
            });
          }
        }
      });
    }
  });
}
