import type { Page } from "@playwright/test";
import { expect, test } from "../security/student-login";

const cyrillic = /\p{Script=Cyrillic}/u;
const routes = [
  { path: "/today", title: "Today" },
  { path: "/schedule", title: "Schedule" },
  { path: "/grades", title: "Study" },
  { path: "/requests", title: "Requests" },
  { path: "/requests/new", title: "New request" },
  { path: "/notifications", title: "Notifications" },
  { path: "/profile", title: "Profile" },
  { path: "/regulations", title: "Dean’s office regulations" },
] as const;

async function expectEnglishControls(page: Page) {
  await expect(page).not.toHaveTitle(cyrillic);
  type AriaNode = { role?: string; name?: string; children?: AriaNode[] };
  const snapshot = (await page
    .locator("body")
    .ariaSnapshotJSON()) as AriaNode[];
  const names: string[] = [];
  function collect(nodes: AriaNode[]) {
    for (const node of nodes) {
      // Settings buttons expose switch roles; include them in the same check.
      if (node.role === "button" || node.role === "switch")
        names.push(node.name ?? "");
      if (node.children) collect(node.children);
    }
  }
  collect(snapshot);
  expect(names.length).toBeGreaterThan(0);
  // One snapshot computes all accessible names, including aria-label and sr-only,
  // without nth-locator indices shifting while controls finish loading.
  // These routes have no buttons whose names contain stored Russian data.
  // Do not exclude a whole region or a pattern if a future DB label needs an exception.
  for (const name of names) {
    expect(name).toMatch(/\S/);
    expect(name).not.toMatch(cyrillic);
  }
}

test.beforeEach(async ({ page, context, baseURL, loginAs }, info) => {
  if (!baseURL) throw new Error("Нужен адрес приложения.");
  await page.setViewportSize(
    info.project.name === "mobile-360"
      ? { width: 360, height: 740 }
      : { width: 1440, height: 900 },
  );
  await loginAs("anna");
  await context.addCookies([
    { name: "pulse-language", value: "en", url: baseURL },
  ]);
});

for (const { path, title } of routes) {
  test(`English: имена кнопок и заголовок вкладки ${path}`, async ({
    page,
  }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      page.getByRole("main").getByRole("heading", {
        name: title,
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
    await expect(page).toHaveTitle(`${title} · Pulse`);
    await expect(page.locator("[data-palette-ready]")).toHaveAttribute(
      "data-palette-ready",
      "true",
    );
    if (path === "/today") {
      await expect(page.getByTestId("today-briefing")).toHaveAttribute(
        "data-briefing-ready",
        "true",
      );
      // The fixture copies these exact seeded DB titles without translating them.
      for (const notification of ["Пара перенесена", "Остался итоговый тест"]) {
        const action = page.getByTestId("today-action").filter({
          has: page.getByRole("heading", {
            name: notification,
            exact: true,
            level: 3,
          }),
        });
        await expect(action).toBeVisible();
        await expect(
          action.getByText("Notification content is available in Russian.", {
            exact: true,
          }),
        ).toBeVisible();
      }
    }
    if (path === "/schedule") {
      await expect(page.locator("[data-calendar-ready]")).toHaveAttribute(
        "data-calendar-ready",
        "true",
      );
    }
    if (path === "/notifications") {
      await expect(page.locator("[data-notifications-ready]")).toHaveAttribute(
        "data-notifications-ready",
        "true",
      );
    }
    if (path === "/profile") {
      await expect(page.locator("[data-settings-ready]")).toHaveAttribute(
        "data-settings-ready",
        "true",
      );
      await expect(
        page.getByRole("region", { name: "Passkeys", exact: true }),
      ).not.toContainText("Loading passkeys…");
      await expect(page.locator("[data-push-state]")).not.toHaveAttribute(
        "data-push-state",
        "loading",
      );
      await expect(
        page.getByRole("button", { name: "Sign out", exact: true }),
      ).toBeVisible();
    }
    await expectEnglishControls(page);
  });
}

test("English: имена кнопок открытой шторки ассистента", async ({ page }) => {
  await page.goto("/today");
  await expect(page).toHaveTitle("Today · Pulse");
  await expect(page.getByTestId("today-briefing")).toHaveAttribute(
    "data-briefing-ready",
    "true",
  );
  await page
    .getByRole("button", { name: "Ask or get things done", exact: true })
    .click();
  const sheet = page.getByRole("dialog", {
    name: "Ask or get things done",
    exact: true,
  });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[data-assistant-ready]")).toHaveAttribute(
    "data-assistant-ready",
    "true",
  );
  const close = sheet.getByRole("button", { name: "Close", exact: true });
  await expect(close).toBeVisible();
  await expectEnglishControls(page);
  await close.click();
  await expect(sheet).not.toBeVisible();
});
