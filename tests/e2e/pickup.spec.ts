import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";
import { PAGE_CACHE_PREFIX } from "@/ui/shell/pwa-cache";
import {
  openPickupFixture,
  type PickupFixture,
} from "../integration/pickup-data";
import { loginAsTestStaff } from "../security/staff-login";
import { loginAsTestStudent } from "../security/student-login";

const test = base.extend<{ pickupData: PickupFixture }>({
  pickupData: async ({ baseURL }, use) => {
    base.skip(!process.env.DATABASE_URL, "Нужна БД лейна");
    if (!baseURL) throw new Error("Укажите адрес приложения");
    const f = await openPickupFixture();
    try {
      await use(f);
    } finally {
      await f.close();
    }
  },
});

async function availableOption(page: Page, label: string, skip = "") {
  const select = page.getByLabel(label, { exact: true });
  const value = await select.locator("option").evaluateAll(
    (options, excluded) =>
      options
        .map((option) => ({
          value: (option as HTMLOptionElement).value,
          disabled: (option as HTMLOptionElement).disabled,
        }))
        .reverse()
        .find(
          (option) =>
            option.value && !option.disabled && option.value !== excluded,
        )?.value,
    skip,
  );
  if (!value) throw new Error(`Нет доступного значения: ${label}`);
  await select.selectOption(value);
  return value;
}
async function checkPage(page: Page) {
  expect(
    await new AxeBuilder({ page })
      .analyze()
      .then((result) => result.violations),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
}

for (const theme of ["light", "dark"])
  test(`бумажная справка: запись, талон, вызов и выдача без перезагрузки · axe ${theme}`, async ({
    page,
    browser,
    baseURL,
    pickupData: f,
  }) => {
    test.setTimeout(90_000);
    const id = await f.ready();
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme,
    );
    await loginAsTestStudent(page, f.studentCredentials.anna);
    await page.goto(`/requests/${id}`);
    const card = page.getByTestId("pickup-card");
    await expect(card).toHaveAttribute("data-ready", "true");
    await card
      .getByLabel("Окно выдачи", { exact: true })
      .selectOption(f.windowId);
    await availableOption(page, "Дата получения");
    await availableOption(page, "Время получения (МСК)");
    await checkPage(page);
    await card
      .getByRole("button", { name: "Записаться на получение", exact: true })
      .click();
    const ticket = page.getByTestId("pickup-ticket");
    await expect(ticket).toBeVisible();
    const [booking] = await f.sql<
      { id: string; ticketNo: string; slotStartsAt: Date }[]
    >`select id, ticket_no as "ticketNo", slot_starts_at as "slotStartsAt" from pickup_bookings where request_id = ${id} and status = 'booked'`;
    if (!booking) throw new Error("Не создан талон");
    const expectedTime = new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      hour: "2-digit",
      minute: "2-digit",
    }).format(booking.slotStartsAt);
    await expect(ticket).toContainText(booking.ticketNo);
    await expect(ticket).toContainText(expectedTime);
    await expect(ticket).toContainText("окно 2");
    const todayDocument = await page.goto("/today");
    expect(todayDocument?.status()).toBe(200);
    expect(await todayDocument?.text()).toContain(f.marker);
    await expect(page.getByRole("main")).toContainText(booking.ticketNo);
    await page.goto(`/requests/${id}`);
    await expect(ticket).toBeVisible();
    await checkPage(page);
    // Queue operations stay reproducible after hours and on weekends.
    await f.bringToToday(booking.id);
    await page.evaluate(() => {
      document.documentElement.dataset.pickupNavigation = "persistent";
    });
    const staffContext = await browser.newContext({
      baseURL,
      viewport: page.viewportSize() ?? undefined,
      reducedMotion: "reduce",
    });
    try {
      const staff = await staffContext.newPage();
      await staff.addInitScript(
        (value) => localStorage.setItem("theme", value),
        theme,
      );
      await loginAsTestStaff(staff, f.limitedCredentials);
      await staff
        .getByRole("link", { name: "Очередь сегодня", exact: true })
        .first()
        .click();
      await expect(staff).toHaveURL(/\/staff\/pickup$/);
      const queue = staff.getByRole("region", { name: "Талоны на сегодня" });
      await expect(queue).toHaveAttribute("data-ready", "true");
      const item = staff
        .getByTestId("pickup-queue-ticket")
        .filter({ hasText: `Окно 2 · ${f.marker}` });
      await expect(item).toBeVisible();
      await checkPage(staff);
      await item.getByRole("button", { name: "Вызвать", exact: true }).click();
      await expect(item).toContainText("Вызван");
      await page.bringToFront();
      await expect(card).toContainText("Вас вызывают в окно 2", {
        timeout: 20_000,
      });
      await expect(page.locator("html")).toHaveAttribute(
        "data-pickup-navigation",
        "persistent",
      );
      await checkPage(page);
      await staff.bringToFront();
      await item.getByRole("button", { name: "Выдано", exact: true }).click();
      await expect(item).toContainText("Выдан");
      await page.bringToFront();
      await expect(
        page.getByRole("main").locator('[aria-current="step"]'),
      ).toContainText("Выдана", { timeout: 20_000 });
      await expect(page.locator("html")).toHaveAttribute(
        "data-pickup-navigation",
        "persistent",
      );
      expect(
        await f.sql`select status from pickup_bookings where id = ${booking.id}`,
      ).toEqual([{ status: "served" }]);
      expect(
        await f.sql`select id from request_events where request_id = ${id} and to_status = 'issued'`,
      ).toHaveLength(1);
      expect(
        await f.sql`select id from staff_audit_log where request_id = ${id} and action = 'request.issue'`,
      ).toHaveLength(1);
    } finally {
      await staffContext.close();
    }
  });

test("до начала слота студент переносит запись и отменяет её", async ({
  page,
  pickupData: f,
}) => {
  const id = await f.ready();
  await loginAsTestStudent(page, f.studentCredentials.anna);
  await page.goto(`/requests/${id}`);
  const card = page.getByTestId("pickup-card");
  await expect(card).toHaveAttribute("data-ready", "true");
  await card
    .getByLabel("Окно выдачи", { exact: true })
    .selectOption(f.windowId);
  await availableOption(page, "Дата получения");
  await availableOption(page, "Время получения (МСК)");
  await card
    .getByRole("button", { name: "Записаться на получение", exact: true })
    .click();
  await expect(page.getByTestId("pickup-ticket")).toBeVisible();
  const [before] = await f.sql<
    { id: string }[]
  >`select id from pickup_bookings where request_id = ${id} and status = 'booked'`;
  await card
    .getByRole("button", { name: "Перенести запись", exact: true })
    .click();
  await availableOption(page, "Дата получения");
  await availableOption(page, "Время получения (МСК)");
  await card
    .getByRole("button", { name: "Подтвердить перенос", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await f.sql`select id from pickup_bookings where request_id = ${id} and status = 'cancelled'`
        ).length,
    )
    .toBe(1);
  const [after] = await f.sql<
    { id: string }[]
  >`select id from pickup_bookings where request_id = ${id} and status = 'booked'`;
  expect(after?.id).not.toBe(before?.id);
  await card
    .getByRole("button", { name: "Отменить запись", exact: true })
    .click();
  await expect(page.getByTestId("pickup-ticket")).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: "Записаться на получение", exact: true }),
  ).toBeVisible();
  expect(
    await f.sql`select id from pickup_bookings where request_id = ${id} and status in ('booked', 'called')`,
  ).toHaveLength(0);
});

test.describe("Сегодня с талоном сохраняется офлайн", () => {
  test.use({ serviceWorkers: "allow" });

  test("чтение талона не отправляет POST, сохраняет HTML и не открывает всю карточку на телефоне", async ({
    page,
    pickupData: f,
  }, info) => {
    test.setTimeout(90_000);
    const id = await f.ready();
    await loginAsTestStudent(page, f.studentCredentials.anna);
    await expect
      .poll(
        () => page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
        { timeout: 15_000 },
      )
      .toBe(true);
    await page.goto(`/requests/${id}`);
    const card = page.getByTestId("pickup-card");
    await expect(card).toHaveAttribute("data-ready", "true");
    await card
      .getByLabel("Окно выдачи", { exact: true })
      .selectOption(f.windowId);
    await availableOption(page, "Дата получения");
    await availableOption(page, "Время получения (МСК)");
    await card
      .getByRole("button", { name: "Записаться на получение", exact: true })
      .click();
    await expect(page.getByTestId("pickup-ticket")).toBeVisible();
    const posts: string[] = [];
    const recordPost = (request: import("@playwright/test").Request) => {
      if (request.method() === "POST")
        posts.push(new URL(request.url()).pathname);
    };
    page.on("request", recordPost);
    const todayDocument = await page.goto("/today");
    expect(todayDocument?.status()).toBe(200);
    expect(await todayDocument?.text()).toContain(f.marker);
    const todayHeading = page
      .getByRole("main")
      .getByRole("heading", { level: 1, name: "Сегодня", exact: true });
    await expect(todayHeading).toBeVisible();
    const tickets = page
      .getByTestId("today-pickup-ticket")
      .filter({ visible: true });
    await expect(tickets).toHaveCount(1);
    await expect(tickets).toHaveAttribute("href", `/requests/${id}`);
    await expect(tickets).toContainText("окно 2");
    await expect
      .poll(
        () =>
          page.evaluate(
            async ({ prefix, link, marker }) => {
              for (const name of (await caches.keys()).filter((cache) =>
                cache.startsWith(prefix),
              )) {
                const cache = await caches.open(name);
                const snapshot = await cache.match("/today");
                if (snapshot) {
                  const html = await snapshot.text();
                  if (html.includes(link) && html.includes(marker)) return true;
                }
              }
              return false;
            },
            {
              prefix: PAGE_CACHE_PREFIX,
              link: `/requests/${id}`,
              marker: f.marker,
            },
          ),
        { timeout: 20_000 },
      )
      .toBe(true);
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            performance.getEntriesByType("resource").some((entry) => {
              const resource = entry as PerformanceResourceTiming;
              const url = new URL(resource.name);
              return (
                resource.initiatorType === "fetch" &&
                url.origin === location.origin &&
                url.pathname === "/today" &&
                !url.search &&
                resource.workerStart > 0 &&
                resource.responseEnd > 0
              );
            }),
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
    expect(posts).toEqual([]);
    page.off("request", recordPost);
    const mobile = (page.viewportSize()?.width ?? 0) < 1024;
    if (mobile) await expect(page.getByTestId("today-requests")).toBeHidden();
    else await expect(page.getByTestId("today-requests")).toBeVisible();
    await checkPage(page);
    await page.screenshot({
      path: info.outputPath("pickup-today-with-ticket.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.goto(`/requests/${id}`);
    await expect(card).toHaveAttribute("data-ready", "true");
    await card
      .getByRole("button", { name: "Отменить запись", exact: true })
      .click();
    await expect(page.getByTestId("pickup-ticket")).toHaveCount(0);
    await page.goto("/today");
    await expect(todayHeading).toBeVisible();
    await expect(page.getByTestId("today-pickup-ticket")).toHaveCount(0);
    if (mobile) await expect(page.getByTestId("today-requests")).toBeHidden();
    await checkPage(page);
    await page.screenshot({
      path: info.outputPath("pickup-today-without-ticket.png"),
      fullPage: true,
      animations: "disabled",
    });
  });
});
