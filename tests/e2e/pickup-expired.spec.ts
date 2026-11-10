import { test as base, expect } from "@playwright/test";
import {
  openPickupFixture,
  type PickupFixture,
  pickupToday,
} from "../integration/pickup-data";
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

for (const status of ["booked", "called"] as const)
  test(`прошедший талон ${status}: студент записывается снова, история сохраняется`, async ({
    page,
    pickupData: f,
  }) => {
    f.clock.set("2026-11-05T06:00:00.000Z");
    const id = await f.ready();
    const previous = await f.book.execute(f.anna, {
      id,
      windowId: f.windowId,
      slotStartsAt: "2026-11-05T09:00:00.000Z",
    });
    if (status === "called")
      await f.changePickup.execute(f.limited, {
        id: previous.id,
        to: "called",
      });
    const yesterday = new Date(
      Date.parse(`${pickupToday()}T09:00:00+03:00`) - 86_400_000,
    ).toISOString();
    await f.bringToToday(previous.id, yesterday);

    await loginAsTestStudent(page, f.studentCredentials.anna);
    await page.goto(`/requests/${id}`);
    const card = page.getByTestId("pickup-card");
    await expect(card).toHaveAttribute("data-ready", "true");
    const expiredMessage = card.getByText("Запись прошла — запишитесь снова", {
      exact: true,
    });
    await expect(expiredMessage).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Перенести запись", exact: true }),
    ).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: "Отменить запись", exact: true }),
    ).toHaveCount(0);
    await card
      .getByLabel("Окно выдачи", { exact: true })
      .selectOption(f.windowId);
    for (const label of ["Дата получения", "Время получения (МСК)"]) {
      const select = card.getByLabel(label, { exact: true });
      const last = await select.locator("option").last().getAttribute("value");
      if (!last) throw new Error(`Нет доступного значения: ${label}`);
      await select.selectOption(last);
    }
    const slotStartsAt = await card
      .getByLabel("Время получения (МСК)", { exact: true })
      .inputValue();
    await card
      .getByRole("button", { name: "Записаться снова", exact: true })
      .click();
    await expect(expiredMessage).toHaveCount(0);
    await expect(page.getByTestId("pickup-ticket")).toBeVisible();
    await expect(card).toContainText("Запись сохранена. Ваш талон готов.");

    const bookings = await f.sql<
      { id: string; status: string; slotStartsAt: Date }[]
    >`select id, status, slot_starts_at as "slotStartsAt" from pickup_bookings where request_id = ${id}`;
    expect(bookings).toHaveLength(2);
    expect(bookings.find((booking) => booking.id === previous.id)?.status).toBe(
      "no_show",
    );
    const active = bookings.filter((booking) =>
      ["booked", "called"].includes(booking.status),
    );
    expect(active).toHaveLength(1);
    expect(active[0]?.id).not.toBe(previous.id);
    expect(active[0]?.slotStartsAt.toISOString()).toBe(slotStartsAt);
    expect(await f.sql`select status from requests where id = ${id}`).toEqual([
      { status: "ready" },
    ]);
    expect(
      await f.sql`select id from request_events where request_id = ${id} and to_status = 'issued'`,
    ).toHaveLength(0);
  });
