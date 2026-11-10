import AxeBuilder from "@axe-core/playwright";
import { expect, loginAsTestStudent, test } from "../security/student-login";
import { expectUniqueTodayControls } from "./today-controls";
import { openTodaySchedule } from "./today-data";
import { installTodaySpeech } from "./today-speech";

const serverSpeech = process.env.E2E_TTS === "1";
test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ page }) => {
  await page.route("**/api/me/briefing/*", (route) =>
    route.fulfill({ status: 503, body: "{}" }),
  );
});

test("сводка читается по фразам ru-RU только после нажатия; стоп отсекает запоздавший конец", async ({
  page,
  loginAs,
}) => {
  await installTodaySpeech(page);
  await page.clock.setFixedTime(new Date());
  await loginAs("anna");
  const card = page.getByTestId("today-briefing");
  await expect(card).toHaveAttribute("data-briefing-ready", "true");
  await expect(card.getByTestId("briefing-phrase").first()).toBeVisible();
  const listen = card.getByRole("button", { name: "Послушать", exact: true });
  await expect(listen).toBeVisible();
  const phrases = await card.getByTestId("briefing-phrase").allTextContents();
  const spoken = await card
    .getByTestId("briefing-phrase")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-spoken")),
    );
  expect(phrases.length).toBeGreaterThanOrEqual(3);
  expect(phrases.length).toBeLessThanOrEqual(5);
  await expect
    .poll(() => page.evaluate(() => window.todaySpeech.calls))
    .toEqual([]);
  await listen.focus();
  await page.keyboard.press("Enter");
  await expect(card.getByTestId("briefing-status")).toHaveText(
    `${serverSpeech ? "Включён голос устройства. " : ""}Читается фраза 1 из ${phrases.length}.`,
  );
  await expect(card.locator('[data-speaking="true"]')).toHaveText(
    phrases[0] ?? "",
  );
  await expect
    .poll(() => page.evaluate(() => window.todaySpeech.calls))
    .toEqual([
      {
        text: spoken[0],
        lang: "ru-RU",
        voice: "Тестовый русский голос",
      },
    ]);
  for (let i = 1; i < phrases.length; i++) {
    await page.evaluate(() => window.todaySpeech.finish());
    await expect(card.locator('[data-speaking="true"]')).toHaveText(
      phrases[i] ?? "",
    );
  }
  await page.evaluate(() => window.todaySpeech.finish());
  await expect(card.getByTestId("briefing-status")).toHaveText(
    "Сводка прочитана.",
  );
  await expect(card.locator('[data-speaking="true"]')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.todaySpeech.calls.map(({ text, lang }) => ({ text, lang })),
      ),
    )
    .toEqual(
      spoken.map((text) => ({
        text,
        lang: "ru-RU",
      })),
    );
  await listen.click();
  const count = phrases.length + 1;
  await expect
    .poll(() => page.evaluate(() => window.todaySpeech.calls.length))
    .toBe(count);
  await card.getByRole("button", { name: "Стоп", exact: true }).click();
  await expect(card.getByTestId("briefing-status")).toHaveText(
    "Чтение остановлено.",
  );
  await expect
    .poll(() => page.evaluate(() => window.todaySpeech.cancelCount))
    .toBe(1);
  await page.evaluate(() => window.todaySpeech.finishCancelled());
  await expect
    .poll(() => page.evaluate(() => window.todaySpeech.calls.length))
    .toBe(count);
  await expect(listen).toBeVisible();
});

test("русский голос появляется асинхронно и исчезает: кнопка и пояснение обновляются", async ({
  page,
  loginAs,
}) => {
  await installTodaySpeech(page, "delayed");
  await page.clock.setFixedTime(new Date());
  await loginAs("anna");
  const card = page.getByTestId("today-briefing");
  await expect(card).toHaveAttribute("data-briefing-ready", "true");
  await expect(card.getByTestId("briefing-phrase").first()).toBeVisible();
  if (serverSpeech) {
    await expect(
      card.getByRole("button", { name: "Послушать", exact: true }),
    ).toBeVisible();
  } else {
    await expect(card).toContainText("Русский голос пока недоступен");
    await expect(
      card.getByRole("button", { name: "Послушать", exact: true }),
    ).toHaveCount(0);
  }
  await expect(card.getByTestId("briefing-phrase").first()).toBeVisible();
  await page.evaluate(() => window.todaySpeech.loadRussian());
  await expect(
    card.getByRole("button", { name: "Послушать", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.todaySpeech.calls))
    .toEqual([]);
  await card.getByRole("button", { name: "Послушать", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.todaySpeech.calls.length))
    .toBe(1);
  await page.evaluate(() => window.todaySpeech.removeRussian());
  if (!serverSpeech)
    await expect(card).toContainText("Русский голос пока недоступен");
  await expect(
    card.getByRole("button", { name: "Стоп", exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.todaySpeech.cancelCount))
    .toBe(1);
});

for (const mode of ["no-russian", "unsupported"] as const) {
  test(`озвучка ${mode}: текст виден, кнопка скрыта и есть пояснение`, async ({
    page,
    loginAs,
  }) => {
    await installTodaySpeech(page, mode);
    await loginAs("anna");
    const card = page.getByTestId("today-briefing");
    await expect(card).toHaveAttribute("data-briefing-ready", "true");
    await expect(card.getByTestId("briefing-phrase").first()).toBeVisible();
    const explanation =
      mode === "unsupported"
        ? "Озвучка недоступна в этом браузере. Сводку можно прочитать."
        : "Русский голос пока недоступен. Сводку можно прочитать.";
    if (serverSpeech) {
      await card
        .getByRole("button", { name: "Послушать", exact: true })
        .click();
      await expect(card.getByTestId("briefing-status")).toContainText(
        "Не удалось озвучить",
      );
    } else {
      await expect(card.getByText(explanation, { exact: true })).toBeVisible();
      await expect(
        card.getByRole("button", { name: "Послушать", exact: true }),
      ).toHaveCount(0);
    }
    await expect(
      card.getByRole("button", { name: "Спросить подробнее", exact: true }),
    ).toBeVisible();
  });
}

test("ошибка речи допускает повтор, размонтирование и pagehide останавливают чтение", async ({
  page,
  loginAs,
}) => {
  await installTodaySpeech(page);
  await page.clock.setFixedTime(new Date());
  await loginAs("anna");
  const card = page.getByTestId("today-briefing");
  await expect(card).toHaveAttribute("data-briefing-ready", "true");
  await expect(card.getByTestId("briefing-phrase").first()).toBeVisible();
  const listen = card.getByRole("button", { name: "Послушать", exact: true });
  await listen.click();
  await expect
    .poll(() => page.evaluate(() => window.todaySpeech.calls.length))
    .toBeGreaterThan(0);
  await page.evaluate(() => window.todaySpeech.fail());
  await expect(card.getByTestId("briefing-status")).toContainText(
    "Не удалось озвучить",
  );
  await listen.click();
  await expect
    .poll(() => page.evaluate(() => window.todaySpeech.calls.length))
    .toBe(2);
  await page.getByTestId("day-pulse").getByRole("link").click();
  await expect(page).toHaveURL(/\/schedule(?:\?|$)/);
  await expect(card).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.todaySpeech.cancelCount))
    .toBe(2);
  await page.evaluate(() => window.todaySpeech.finishCancelled());
  await expect
    .poll(() => page.evaluate(() => window.todaySpeech.calls.length))
    .toBe(2);
  await page.goto("/today");
  await listen.click();
  await expect
    .poll(() => page.evaluate(() => window.todaySpeech.calls.length))
    .toBe(1);
  await page.reload();
  await expect(listen).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.todaySpeech.cancelCount))
    .toBe(3);
  await expect
    .poll(() => page.evaluate(() => window.todaySpeech.calls))
    .toEqual([]);
});

test("Спросить подробнее открывает единую шторку с вопросом о сегодняшнем дне", async ({
  page,
  loginAs,
}) => {
  test.skip(
    process.env.ASSISTANT_RUNTIME !== "mock",
    "Нужен mock-рантайм ассистента.",
  );
  await installTodaySpeech(page);
  await page.clock.setFixedTime(new Date());
  await loginAs("timur");
  const card = page.getByTestId("today-briefing");
  await expect(card).toHaveAttribute("data-briefing-ready", "true");
  await expect(card.getByTestId("briefing-phrase").first()).toBeVisible();
  await expect(card).toContainText("Основы маркетинга — есть долг");
  await expect(
    card.getByRole("link", { name: /Что можно сделать/ }),
  ).toHaveCount(0);
  await expectUniqueTodayControls(page.getByRole("main"));
  await card.getByRole("button", { name: "Послушать", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.todaySpeech.calls.length))
    .toBe(1);
  await card
    .getByRole("button", { name: "Спросить подробнее", exact: true })
    .click();
  const sheet = page.getByRole("dialog", {
    name: "Спросить или сделать",
    exact: true,
  });
  await expect(sheet).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(sheet.getByRole("log")).toContainText(
    "Расскажи подробнее о моём сегодняшнем дне: расписании, главном действии и учёбе.",
  );
  await expect
    .poll(() => page.evaluate(() => window.todaySpeech.cancelCount))
    .toBe(1);
  await expect(sheet.getByRole("log")).toContainText(
    "Проверьте сведения и источники ниже.",
  );
  await expect(
    sheet.getByRole("button", { name: "Есть ли долги?", exact: true }),
  ).toBeEnabled();
  await sheet.getByRole("link", { name: "Мой журнал", exact: true }).click();
  await expect(page).toHaveURL(/\/profile\/assistant$/);
  await expect(sheet).not.toBeVisible();
  await expect(
    page
      .getByRole("main")
      .getByText(
        "Расскажи подробнее о моём сегодняшнем дне: расписании, главном действии и учёбе.",
        { exact: true },
      ),
  ).toBeVisible();
});

test("минуты сводки совпадают с Пульсом и обновление текста останавливает старую речь", async ({
  page,
  students,
}) => {
  const student = await students.get("anna");
  const schedule = await openTodaySchedule(student.actor.studentId);
  try {
    await installTodaySpeech(page);
    await page.clock.install();
    await loginAsTestStudent(page, student.credentials);
    const pulse = page.getByTestId("day-pulse");
    await expect(
      pulse.locator(".day-timeline-now circle").first(),
    ).toBeVisible();
    const card = page.getByTestId("today-briefing");
    await expect(card).toHaveAttribute("data-briefing-ready", "true");
    await expect(card.getByTestId("briefing-phrase").first()).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Послушать", exact: true }),
    ).toBeVisible();
    await page.clock.pauseAt(
      new Date(schedule.startsAt.getTime() - 5 * 60_000),
    );
    await expect(pulse.getByRole("status")).toHaveText("Через 5 мин");
    await expect(card.getByTestId("briefing-phrase").first()).toContainText(
      "Через 5 минут",
    );
    await card.getByRole("button", { name: "Послушать", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.todaySpeech.calls.length))
      .toBe(1);
    await page.clock.runFor(60_000);
    await expect(pulse.getByRole("status")).toHaveText("Через 4 мин");
    await expect(card.getByTestId("briefing-phrase").first()).toContainText(
      "Через 4 минуты",
    );
    await expect(card.getByTestId("briefing-status")).toContainText(
      "Сводка обновилась",
    );
    await expect
      .poll(() => page.evaluate(() => window.todaySpeech.cancelCount))
      .toBe(1);
  } finally {
    await schedule.close();
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`сводка ${theme}: axe, уникальные кнопки и ширина 360 px`, async ({
    page,
    loginAs,
  }) => {
    await installTodaySpeech(page);
    await page.clock.setFixedTime(new Date());
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript(
      (theme) => localStorage.setItem("pulse-theme", theme),
      theme,
    );
    await loginAs("anna");
    const card = page.getByTestId("today-briefing");
    await expect(card).toHaveAttribute("data-briefing-ready", "true");
    await expect(card.getByTestId("briefing-phrase").first()).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Послушать", exact: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    await page.evaluate(() => document.fonts.ready);
    await expectUniqueTodayControls(page.getByRole("main"));
    for (const button of await card.getByRole("button").all()) {
      const metrics = await button.evaluate((element) => ({
        width: element.clientWidth,
        scroll: element.scrollWidth,
        height: element.clientHeight,
        wrap: getComputedStyle(element).overflowWrap,
        whiteSpace: getComputedStyle(element).whiteSpace,
      }));
      expect(metrics.scroll).toBeLessThanOrEqual(metrics.width);
      expect(metrics.height).toBeGreaterThanOrEqual(44);
      expect(metrics.height).toBeLessThanOrEqual(48);
      expect(metrics.wrap).toBe("normal");
      expect(metrics.whiteSpace).toBe("nowrap");
      await expect(button).not.toHaveAttribute("aria-label");
    }
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await card.getByRole("button", { name: "Послушать", exact: true }).click();
    await expect(card.locator('[data-speaking="true"]')).toHaveCSS(
      "font-weight",
      "600",
    );
    await expect(card.locator('[data-speaking="true"]')).not.toHaveCSS(
      "border-left-color",
      "rgba(0, 0, 0, 0)",
    );
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  });
}
