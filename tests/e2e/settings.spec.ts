import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { loginAs } from "../security/login";

const settings = [
  {
    label: "Крупный текст",
    cookie: "pulse-large-text",
    className: "a11y-large-text",
  },
  {
    label: "Высокий контраст",
    cookie: "pulse-high-contrast",
    className: "a11y-high-contrast",
  },
  {
    label: "Меньше движения",
    cookie: "pulse-reduced-motion",
    className: "a11y-reduced-motion",
  },
] as const;

for (const account of ["anna", "marina"] as const) {
  test(`настройки ${account}: переключение без перезагрузки, сохранение и выход`, async ({
    page,
    context,
  }) => {
    await loginAs(page, account);
    const profile = account === "anna" ? "/profile" : "/staff/profile";
    await page.goto(profile);
    const card = page.getByRole("region", { name: "Настройки", exact: true });
    await expect(card).toHaveAttribute("data-settings-ready", "true");
    await expect(card.getByRole("switch")).toHaveCount(3);
    const documentStart = await page.evaluate(() => performance.timeOrigin);

    for (const setting of settings) {
      const toggle = card.getByRole("switch", {
        name: setting.label,
        exact: true,
      });
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      expect(await toggle.getAttribute("aria-label")).toBeNull();
      await toggle.focus();
      expect(
        await toggle.evaluate((element) => {
          const style = getComputedStyle(element);
          return style.outlineStyle !== "none" && style.outlineWidth !== "0px";
        }),
      ).toBe(true);
      await page.keyboard.press("Space");
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      await expect(page.locator("html")).toHaveClass(
        new RegExp(`\\b${setting.className}\\b`),
      );
      const cookie = (await context.cookies()).find(
        (cookie) => cookie.name === setting.cookie,
      );
      expect(cookie).toMatchObject({
        value: "on",
        path: "/",
        sameSite: "Lax",
        httpOnly: false,
        secure: new URL(page.url()).protocol === "https:",
      });
      expect(cookie?.expires).toBeGreaterThan(Date.now() / 1000 + 360 * 86400);
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(
        documentStart,
      );
    }

    await page.getByRole("button", { name: "Переключить тему" }).click();
    for (const setting of settings)
      await expect(page.locator("html")).toHaveClass(
        new RegExp(`\\b${setting.className}\\b`),
      );
    await page.reload();
    await expect(card).toHaveAttribute("data-settings-ready", "true");
    for (const setting of settings)
      await expect(
        card.getByRole("switch", { name: setting.label, exact: true }),
      ).toHaveAttribute("aria-checked", "true");

    await expect
      .poll(async () => (await new AxeBuilder({ page }).analyze()).violations)
      .toEqual([]);
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    for (const setting of settings)
      await expect(page.locator("html")).toHaveClass(
        new RegExp(`\\b${setting.className}\\b`),
      );
    await page.reload();
    for (const setting of settings)
      await expect(page.locator("html")).toHaveClass(
        new RegExp(`\\b${setting.className}\\b`),
      );

    await loginAs(page, account === "anna" ? "marina" : "anna");
    await page.goto(account === "anna" ? "/staff/profile" : "/profile");
    await expect(card).toHaveAttribute("data-settings-ready", "true");
    for (const setting of settings) {
      const toggle = card.getByRole("switch", {
        name: setting.label,
        exact: true,
      });
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await expect(page.locator("html")).not.toHaveClass(
        new RegExp(`\\b${setting.className}\\b`),
      );
      expect(
        (await context.cookies()).find(
          (cookie) => cookie.name === setting.cookie,
        )?.value,
      ).toBe("off");
    }
    await page.reload();
    for (const setting of settings)
      await expect(
        card.getByRole("switch", { name: setting.label, exact: true }),
      ).toHaveAttribute("aria-checked", "false");
  });
}

test("крупный текст масштабирует корень и адаптивные заголовки ровно на 25%", async ({
  page,
}, info) => {
  const widths = info.project.name === "mobile-360" ? [360] : [768, 1440];
  await loginAs(page, "anna");
  await page.goto("/profile");
  const card = page.getByRole("region", { name: "Настройки", exact: true });
  await expect(card).toHaveAttribute("data-settings-ready", "true");
  await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.id = "settings-font-probe";
    probe.innerHTML =
      '<span class="text-display">25</span><span class="text-greeting">Привет</span>';
    document.querySelector("main")?.append(probe);
  });
  const toggle = card.getByRole("switch", {
    name: "Крупный текст",
    exact: true,
  });
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const fontSizes = () =>
      page.evaluate(() =>
        [
          document.documentElement,
          ...document.querySelectorAll("#settings-font-probe span"),
        ].map((element) =>
          Number.parseFloat(getComputedStyle(element).fontSize),
        ),
      );
    const before = await fontSizes();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    const after = await fontSizes();
    for (let index = 0; index < before.length; index++)
      expect((after[index] ?? 0) / (before[index] ?? 1)).toBeCloseTo(1.25, 2);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  }
});

test("меньше движения перекрывает анимации и переходы, системный выбор сохраняется", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await loginAs(page, "anna");
  await page.goto("/profile");
  const card = page.getByRole("region", { name: "Настройки", exact: true });
  await expect(card).toHaveAttribute("data-settings-ready", "true");
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = `
      @keyframes settingsMotionProbe { from { opacity: .5 } to { opacity: 1 } }
      .settings-motion-probe::before {
        content: "";
        animation: settingsMotionProbe 5s infinite;
        transition: opacity 2s;
      }
    `;
    document.head.append(style);
    const probe = document.createElement("div");
    probe.className = "settings-motion-probe";
    probe.style.animation = "settingsMotionProbe 5s infinite";
    probe.style.transition = "opacity 2s";
    document.querySelector("main")?.append(probe);
  });
  const motion = () =>
    page.locator(".settings-motion-probe").evaluate((element) =>
      [null, "::before"].map((pseudo) => {
        const style = getComputedStyle(element, pseudo);
        return {
          animation: style.animationName,
          transition: style.transitionDuration,
          scroll: style.scrollBehavior,
        };
      }),
    );
  await expect.poll(motion).toEqual([
    { animation: "settingsMotionProbe", transition: "2s", scroll: "auto" },
    { animation: "settingsMotionProbe", transition: "2s", scroll: "auto" },
  ]);
  const toggle = card.getByRole("switch", {
    name: "Меньше движения",
    exact: true,
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  const stopped = [
    { animation: "none", transition: "0s", scroll: "auto" },
    { animation: "none", transition: "0s", scroll: "auto" },
  ];
  await expect.poll(motion).toEqual(stopped);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect.poll(motion).toEqual([
    { animation: "settingsMotionProbe", transition: "2s", scroll: "auto" },
    { animation: "settingsMotionProbe", transition: "2s", scroll: "auto" },
  ]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(motion).toEqual(stopped);
  await expect(page.locator("html")).not.toHaveClass(/a11y-reduced-motion/);
});
