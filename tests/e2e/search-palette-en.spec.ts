import AxeBuilder from "@axe-core/playwright";
import type { SearchDto } from "@/application/search/dto";
import { expect, test } from "../security/student-login";
import {
  englishStudent,
  englishViewport,
  noHorizontalOverflow,
} from "./search-en-helpers";

test("English: ⌘K и Ctrl+K в двух раскладках, стрелки и переход к паре", async ({
  page,
  context,
  baseURL,
  students,
}) => {
  await englishStudent(
    page,
    context,
    baseURL,
    (await students.get("anna")).credentials,
  );
  await page.goto("/search?q=");
  const trigger = page.getByRole("link", { name: /Search your portal/ });
  await expect(trigger).toHaveAttribute("data-palette-ready", "true");
  const dialog = page.getByRole("dialog", {
    name: "Search and actions",
    exact: true,
  });
  for (const modifier of ["Meta", "Control"]) {
    await page.keyboard.press(`${modifier}+k`);
    await expect(dialog).toBeVisible();
    const field = dialog.getByRole("combobox", { name: "What to find or do" });
    await expect(field).toBeFocused();
    await expect(dialog).toHaveAccessibleDescription(
      "Search your portal or choose an action.",
    );
    await expect(dialog).toContainText(
      "↑↓ to choose, Enter to open, Escape to close.",
    );
    await field.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.evaluate((modifier) => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "л",
          code: "KeyK",
          metaKey: modifier === "Meta",
          ctrlKey: modifier === "Control",
          bubbles: true,
          cancelable: true,
        }),
      );
    }, modifier);
    await expect(dialog).toBeVisible();
    await field.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
  await trigger.click();
  const field = dialog.getByRole("combobox");
  await field.fill("геогр");
  const first = dialog
    .getByRole("group", { name: "Schedule", exact: true })
    .getByRole("option")
    .first();
  await expect(first).toContainText("Политическая география");
  await expect(first).toContainText("room ДЕМО-");
  await expect(dialog.getByRole("status")).toHaveText(/Results found: [1-9]/);
  await field.press("ArrowDown");
  await expect(first).toHaveAttribute("aria-selected", "true");
  await field.press("Enter");
  await expect(page).toHaveURL(/\/schedule\?view=week&week=/);
});

test("English: ошибка подсказок с повтором и доказанный пустой результат", async ({
  page,
  context,
  baseURL,
  students,
}) => {
  await englishStudent(
    page,
    context,
    baseURL,
    (await students.get("anna")).credentials,
  );
  const trigger = page.getByRole("link", { name: /Search your portal/ });
  await expect(trigger).toHaveAttribute("data-palette-ready", "true");
  await page.route("**/api/search/suggest?**", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: "Search and actions",
    exact: true,
  });
  const field = dialog.getByRole("combobox");
  await field.fill("геогр");
  const retry = dialog.getByRole("button", {
    name: "Retry search",
    exact: true,
  });
  await expect(retry).toBeVisible();
  await expect(dialog).toContainText("Some suggestions are unavailable.");
  await page.unroute("**/api/search/suggest?**");
  await retry.click();
  await expect(
    dialog.getByRole("group", { name: "Schedule", exact: true }),
  ).toContainText("Политическая география");
  const emptyQuery = "щщщзз";
  const response = await page.request.get(
    `/api/search/suggest?${new URLSearchParams({ q: emptyQuery })}`,
    { headers: { "Sec-Fetch-Site": "same-origin" } },
  );
  expect(response.status()).toBe(200);
  const result = (await response.json()) as SearchDto;
  expect(result.groups.length).toBe(4);
  expect(
    result.groups.every(
      (group) => group.status === "ok" && group.items.length === 0,
    ),
  ).toBe(true);
  await field.fill(emptyQuery);
  await expect(dialog.getByRole("status")).toHaveText("Results found: 0.");
  await expect(
    dialog.getByText("No matches found", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole("group")).toHaveCount(0);
  await expect(
    dialog.getByRole("option", {
      name: `Ask the assistant: ${emptyQuery}`,
      exact: true,
    }),
  ).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`English: палитра ${theme}, axe, 360/1440 и длинные подписи`, async ({
    page,
    context,
    baseURL,
    students,
  }, info) => {
    await englishViewport(page, info);
    await page.addInitScript(
      (value) => localStorage.setItem("pulse-theme", value),
      theme,
    );
    await englishStudent(
      page,
      context,
      baseURL,
      (await students.get("anna")).credentials,
    );
    const trigger = page.getByRole("link", { name: /Search your portal/ });
    await expect(trigger).toHaveAttribute("data-palette-ready", "true");
    const box = await trigger.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await trigger.click();
    const dialog = page.getByRole("dialog", {
      name: "Search and actions",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    for (const query of ["", "геогр", "я".repeat(80)]) {
      await dialog.getByRole("combobox").fill(query);
      if (query)
        await expect(dialog.getByRole("status")).toHaveText(
          query === "геогр" ? /Results found: [1-9]/ : "Results found: 0.",
        );
      await dialog.getByRole("combobox").press("ArrowDown");
      await noHorizontalOverflow(page, dialog);
      for (const option of await dialog.getByRole("option").all()) {
        await expect(option).toHaveCSS("overflow-wrap", "normal");
        await expect(option).toHaveCSS("word-break", "normal");
        expect((await option.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      }
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await info.attach(`Палитра English ${theme} ${query.length}`, {
        body: await page.screenshot({ animations: "disabled" }),
        contentType: "image/png",
      });
    }
  });
}
