import AxeBuilder from "@axe-core/playwright";
import type { SearchDto } from "@/application/search/dto";
import { searchRequestsForStudent } from "../integration/search-data";
import { expect, test } from "../security/student-login";
import {
  englishStudent,
  englishViewport,
  noHorizontalOverflow,
} from "./search-en-helpers";

for (const theme of ["light", "dark"] as const) {
  for (const query of ["", "география", "щщщзз", "а"]) {
    test(`English: поиск «${query || "начало"}», ${theme}, axe и переносы слов`, async ({
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
      if (query === "щщщзз") {
        const response = await page.request.get(
          `/api/search/suggest?${new URLSearchParams({ q: query })}`,
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
      }
      await page.goto(`/search?${new URLSearchParams({ q: query })}`);
      const main = page.getByRole("main");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      await expect(page).toHaveTitle(/Search your portal/);
      await expect(
        main.getByRole("heading", {
          name: "Search your portal",
          exact: true,
          level: 1,
        }),
      ).toBeVisible();
      const field = main.getByRole("searchbox", {
        name: "What to find",
        exact: true,
      });
      await expect(field).toHaveValue(query);
      await expect(main).toContainText("Data is in Russian");
      if (query === "")
        await expect(
          main.getByRole("heading", { name: "Start with a word or number" }),
        ).toBeVisible();
      if (query === "география") {
        const group = main.getByRole("region", {
          name: "Schedule",
          exact: true,
        });
        await expect(group).toContainText("Политическая география");
        await expect(group).toContainText("room ДЕМО-");
        await expect(
          main.getByRole("region", { name: "Studies", exact: true }),
        ).toContainText("Course · assessments and grades");
        await expect(
          main.getByRole("region", { name: "Requests", exact: true }),
        ).toContainText("No matches. Try another word.");
      }
      if (query === "щщщзз")
        await expect(
          main.getByRole("heading", { name: "No results found", exact: true }),
        ).toBeVisible();
      if (query === "а")
        await expect(main.getByRole("alert")).toHaveText(
          "Enter a query of 2–80 characters.",
        );
      await noHorizontalOverflow(page, main);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    });
  }
}

test("English: поиск русских данных ведёт к паре, своей заявке и положению", async ({
  page,
  context,
  baseURL,
  students,
}) => {
  const student = await students.get("anna");
  await englishStudent(page, context, baseURL, student.credentials);
  await page.goto("/search?q=");
  const form = page.locator('form[action="/search"]');
  await expect(form).toHaveAttribute("data-search-ready", "true");
  await page.getByRole("searchbox", { name: "What to find" }).fill("география");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/search" && url.searchParams.get("q") === "география",
  );
  const lesson = page
    .getByRole("region", { name: "Schedule", exact: true })
    .getByRole("link")
    .first();
  await expect(lesson).toContainText("Политическая география");
  await expect(lesson.locator("mark").first()).toBeVisible();
  await lesson.click();
  await expect(page).toHaveURL(/\/schedule\?view=week&week=/);
  await expect(page.getByRole("main")).toContainText("Политическая география");
  const own = (await searchRequestsForStudent(student.actor.studentId))[0];
  if (!own) throw new Error("Нет заявки временной Анны.");
  await page.goto(`/search?${new URLSearchParams({ q: own.publicNo })}`);
  const request = page
    .getByRole("region", { name: "Requests", exact: true })
    .getByRole("link")
    .first();
  await expect(request).toContainText(own.publicNo);
  await expect(request).toContainText("Your request ·");
  await request.click();
  await expect(page).toHaveURL(new RegExp(`/requests/${own.id}$`));
  await page.goto(`/search?${new URLSearchParams({ q: "академотпуск" })}`);
  const regulation = page
    .getByRole("region", { name: "Regulations", exact: true })
    .getByRole("link")
    .first();
  const href = await regulation.getAttribute("href");
  expect(href).toMatch(/^\/regulations\/[a-z-]+#p-\d/);
  await expect(regulation).toContainText(/академ/i);
  await expect(regulation.locator("mark").first()).toBeVisible();
  await regulation.click();
  await expect(page).toHaveURL(new URL(href ?? "", page.url()).href);
});

test("English: ожидание клиентского GET и код ошибки управляющих символов", async ({
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
  const form = page.locator('form[action="/search"]');
  await expect(form).toHaveAttribute("data-search-ready", "true");
  const release = Promise.withResolvers<void>();
  let held = false;
  const matcher = (url: URL) =>
    url.pathname === "/search" && url.searchParams.get("q") === "география";
  await page.route(matcher, async (route) => {
    held = true;
    await release.promise;
    await route.continue();
  });
  let submission: Promise<void> | undefined;
  try {
    const field = page.getByRole("searchbox", { name: "What to find" });
    await field.fill("география");
    submission = field.press("Enter");
    await expect.poll(() => held).toBe(true);
    const pending = page.getByRole("region", {
      name: "Loading search",
      exact: true,
    });
    await expect(pending.getByRole("status")).toHaveText(
      "Searching your portal…",
    );
    await expect(form).toHaveAttribute("aria-busy", "true");
    release.resolve();
    await submission;
    await expect(page).toHaveURL(
      (url) => url.searchParams.get("q") === "география",
    );
    await expect(pending).toHaveCount(0);
  } finally {
    release.resolve();
    await submission;
    await page.unroute(matcher);
  }
  await page.goto(`/search?${new URLSearchParams({ q: "\nгеография" })}`);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Remove control characters from your query.",
  );
});

test("English: обычный GET поиска работает без JavaScript", async ({
  browser,
  baseURL,
  students,
}, info) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport:
      info.project.name === "mobile-360"
        ? { width: 360, height: 740 }
        : { width: 1440, height: 900 },
  });
  try {
    const page = await context.newPage();
    await englishStudent(
      page,
      context,
      baseURL,
      (await students.get("anna")).credentials,
    );
    await page.goto("/search?q=");
    await page
      .getByRole("searchbox", { name: "What to find" })
      .fill("география");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/search" && url.searchParams.get("q") === "география",
    );
    await expect(
      page.getByRole("region", { name: "Schedule", exact: true }),
    ).toContainText("Политическая география");
  } finally {
    await context.close();
  }
});
