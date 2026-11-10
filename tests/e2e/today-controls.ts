import { expect, type Locator } from "@playwright/test";

export async function expectUniqueTodayControls(main: Locator) {
  const controls = main
    .getByRole("link")
    .or(main.getByRole("button"))
    .filter({ visible: true });
  const names = await Promise.all(
    (await controls.all()).map(async (control) => {
      const snapshot = await control.ariaSnapshotJSON({ depth: 1 });
      expect(snapshot).toHaveLength(1);
      const root = snapshot[0] as { name?: string; role?: string };
      expect(root.role).toMatch(/^(link|button)$/);
      expect(root.name).toEqual(expect.any(String));
      expect(root.name).not.toBe("");
      return { name: root.name, href: await control.getAttribute("href") };
    }),
  );
  const duplicates = names.filter(
    (item, index) =>
      names.findIndex((other) => other.name === item.name) !== index,
  );
  expect(
    duplicates,
    "Имена видимых ссылок и кнопок внутри main должны различаться",
  ).toEqual([]);
}

export async function expectTodayTypography(main: Locator) {
  const links = main.getByTestId("today-action").getByRole("link");
  for (const link of await links.all()) {
    const metrics = await link.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        scrollWidth: element.scrollWidth,
        width: element.clientWidth,
        height: element.clientHeight,
        padding:
          Number.parseFloat(style.paddingTop) +
          Number.parseFloat(style.paddingBottom),
        lineHeight: Number.parseFloat(style.lineHeight),
        overflowWrap: style.overflowWrap,
        wordBreak: style.wordBreak,
      };
    });
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width);
    expect(metrics.overflowWrap).toBe("normal");
    expect(metrics.wordBreak).toBe("normal");
    expect(metrics.height - metrics.padding).toBeLessThanOrEqual(
      2 * metrics.lineHeight + 1,
    );
  }
  const heading = main.getByRole("heading", {
    name: "Сегодня",
    exact: true,
    level: 1,
  });
  const metaSize = await main
    .getByTestId("today-meta")
    .evaluate((element) => getComputedStyle(element).fontSize);
  await expect(heading).toHaveCSS("font-size", metaSize);
  expect(Number.parseFloat(metaSize)).toBeLessThanOrEqual(14);
  const greetingSize = await main
    .getByTestId("today-greeting")
    .evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
  expect(greetingSize).toBeGreaterThan(Number.parseFloat(metaSize));

  if (await main.getByTestId("today-week").isVisible()) {
    for (const day of await main.getByTestId("today-week-day").all()) {
      await expect(day).toHaveCSS("hyphens", "auto");
      await expect(day).toHaveCSS("overflow-wrap", "normal");
    }
    const moments = main
      .getByTestId("today-week-lesson-time")
      .or(main.getByTestId("today-week-room"));
    for (const moment of await moments.all())
      await expect(moment).toHaveCSS("white-space", "nowrap");
  }
}

export async function expectTodayRingTone(
  main: Locator,
  tone: "danger" | "warning",
) {
  const ring = main.getByTestId("today-study").getByRole("img");
  await expect(ring).toHaveAttribute("data-tone", tone);
  const colors = await ring.evaluate((element, tone) => {
    const probe = document.createElement("span");
    probe.style.color = `var(--${tone}-ink)`;
    element.append(probe);
    try {
      const value = element.querySelector(".progress-ring-value");
      return {
        expected: getComputedStyle(probe).color,
        actual: value ? getComputedStyle(value).stroke : null,
      };
    } finally {
      probe.remove();
    }
  }, tone);
  expect(colors.actual).toBe(colors.expected);
}
