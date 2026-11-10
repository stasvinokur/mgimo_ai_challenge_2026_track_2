import { test as base, expect, type Page } from "@playwright/test";
import type { Actor } from "@/application/ports/actor";
import {
  openPickupFixture,
  type PickupFixture,
} from "../integration/pickup-data";
import { openTeacherTestData } from "../integration/teacher-e2e-data";
import { loginAsTestStaff } from "./staff-login";
import { loginAsTestStudent } from "./student-login";
import { loginAsTestTeacher } from "./teacher-login";

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

async function prepare(f: PickupFixture, owner: Actor, windowId: string) {
  const id = await f.ready(owner);
  const state = await f.getPickup.execute(owner, { id });
  const slotStartsAt = state.windows
    .find((window) => window.id === windowId)
    ?.slots.at(-1);
  if (!slotStartsAt) throw new Error("Нет свободного слота тестового окна");
  return {
    id,
    ticket: await f.book.execute(owner, { id, windowId, slotStartsAt }),
  };
}
function headers(
  page: Page,
  action: string,
  origin: string | null = new URL(page.url()).origin,
) {
  return {
    "Next-Action": action,
    "Content-Type": "application/json",
    Accept: "text/x-component",
    ...(origin ? { Origin: origin } : {}),
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
  };
}

async function rscForbidden(page: Page) {
  const tree = [
    "",
    {
      children: [
        "(staff)",
        {
          children: [
            "staff",
            {
              children: [
                "pickup",
                { children: ["__PAGE__", {}, null, "refetch"] },
              ],
            },
          ],
        },
      ],
    },
  ];
  const rscHeaders = {
    RSC: "1",
    "Next-Router-State-Tree": encodeURIComponent(JSON.stringify(tree)),
  };
  let response = await page.request.get("/staff/pickup", {
    headers: rscHeaders,
    maxRedirects: 0,
  });
  if (response.status() === 307)
    response = await page.request.get(response.headers().location ?? "", {
      headers: rscHeaders,
      maxRedirects: 0,
    });
  const body = await response.text();
  expect(
    response.status() === 403 || body.includes("NEXT_HTTP_ERROR_FALLBACK;403"),
  ).toBe(true);
  expect(body).not.toContain('data-testid="pickup-queue-ticket"');
}

test("IDOR: чужая заявка по прямому URL и чужой талон через настоящий Server Action дают 404", async ({
  page,
  pickupData: f,
}) => {
  const own = await prepare(f, f.anna, f.windowId);
  const foreign = await prepare(f, f.timur, f.foreignWindowId);
  await loginAsTestStudent(page, f.studentCredentials.anna);
  const response = await page.goto(`/requests/${foreign.id}`);
  expect(response?.status()).toBe(404);
  expect(await response?.text()).not.toContain(f.foreignMarker);
  await page.goto(`/requests/${own.id}`);
  await expect(page.getByTestId("pickup-card")).toHaveAttribute(
    "data-ready",
    "true",
  );
  const capture = page.waitForRequest(
    (request) =>
      request.method() === "POST" && Boolean(request.headers()["next-action"]),
  );
  await page
    .getByRole("button", { name: "Отменить запись", exact: true })
    .click();
  const action = (await capture).headers()["next-action"];
  if (!action) throw new Error("Не найден Server Action отмены");
  await expect(page.getByTestId("pickup-ticket")).toHaveCount(0);
  const attack = await page.request.post(`/requests/${foreign.id}`, {
    headers: headers(page, action),
    data: JSON.stringify([foreign.ticket.id]),
  });
  expect(attack.status()).toBe(404);
  expect(await attack.text()).not.toContain(f.foreignMarker);
  const rejectedOrigin = await page.request.post(`/requests/${own.id}`, {
    headers: headers(page, action, "https://foreign.invalid"),
    data: JSON.stringify([foreign.ticket.id]),
  });
  expect([403, 500]).toContain(rejectedOrigin.status());
  await rejectedOrigin.text();
  expect(
    await f.sql`select status from pickup_bookings where id = ${foreign.ticket.id}`,
  ).toEqual([{ status: "booked" }]);
  expect(
    await f.sql`select id from staff_audit_log where request_id = ${foreign.id}`,
  ).toHaveLength(0);
});

test("BFLA, факультеты и Origin: очередь и действия доступны только сотруднику своего факультета", async ({
  page,
  browser,
  baseURL,
  pickupData: f,
}) => {
  const own = await prepare(f, f.anna, f.windowId);
  const foreign = await prepare(f, f.timur, f.foreignWindowId);
  await f.bringToToday(own.ticket.id);
  await f.bringToToday(foreign.ticket.id);
  await loginAsTestStaff(page, f.limitedCredentials);
  await page.goto("/staff/pickup");
  await expect(
    page.getByRole("region", { name: "Талоны на сегодня" }),
  ).toHaveAttribute("data-ready", "true");
  await expect(page.getByRole("main")).toContainText(`Окно 2 · ${f.marker}`);
  await expect(page.getByRole("main")).not.toContainText(f.foreignMarker);
  expect(
    await f.sql`select faculty_id from staff_faculties where staff_id = ${f.limited.staffId}`,
  ).toEqual([{ faculty_id: f.ownFacultyId }]);
  const item = page
    .getByTestId("pickup-queue-ticket")
    .filter({ hasText: `Окно 2 · ${f.marker}` });
  const capture = page.waitForRequest(
    (request) =>
      request.method() === "POST" && Boolean(request.headers()["next-action"]),
  );
  await item.getByRole("button", { name: "Вызвать", exact: true }).click();
  const action = (await capture).headers()["next-action"];
  if (!action) throw new Error("Не найден Server Action очереди");
  await expect(item).toContainText("Вызван");
  const foreignCall = await page.request.post("/staff/pickup", {
    headers: headers(page, action),
    data: JSON.stringify([{ id: foreign.ticket.id, to: "called" }]),
  });
  expect(foreignCall.status()).toBe(404);
  expect(await foreignCall.text()).not.toContain(f.foreignMarker);
  const missingOrigin = await page.request.post("/staff/pickup", {
    headers: headers(page, action, null),
    data: JSON.stringify([{ id: own.ticket.id, to: "no_show" }]),
  });
  expect(await missingOrigin.text()).toContain('"code":"FORBIDDEN"');
  const badOrigin = await page.request.post("/staff/pickup", {
    headers: headers(page, action, "https://foreign.invalid"),
    data: JSON.stringify([{ id: own.ticket.id, to: "no_show" }]),
  });
  expect([403, 500]).toContain(badOrigin.status());
  await badOrigin.text();
  expect(
    await f.sql`select status from pickup_bookings where id = ${own.ticket.id}`,
  ).toEqual([{ status: "called" }]);
  expect(
    await f.sql`select status from pickup_bookings where id = ${foreign.ticket.id}`,
  ).toEqual([{ status: "booked" }]);
  const teacher = await openTeacherTestData();
  const studentContext = await browser.newContext({ baseURL });
  const teacherContext = await browser.newContext({ baseURL });
  try {
    const studentPage = await studentContext.newPage(),
      teacherPage = await teacherContext.newPage();
    await loginAsTestStudent(studentPage, f.studentCredentials.anna);
    await loginAsTestTeacher(teacherPage, teacher.credentials);
    for (const deniedPage of [studentPage, teacherPage]) {
      const denied = await deniedPage.goto("/staff/pickup");
      expect(denied?.status()).toBe(403);
      expect(await denied?.text()).not.toContain(f.marker);
      await rscForbidden(deniedPage);
      const forged = await deniedPage.request.post("/staff/pickup", {
        headers: headers(deniedPage, action),
        data: JSON.stringify([{ id: own.ticket.id, to: "served" }]),
      });
      expect(forged.status()).toBe(403);
      expect(await forged.text()).not.toContain(f.marker);
    }
  } finally {
    await Promise.all([studentContext.close(), teacherContext.close()]);
    await teacher.close();
  }
  expect(await f.sql`select status from requests where id = ${own.id}`).toEqual(
    [{ status: "ready" }],
  );
  expect(
    await f.sql`select id from request_events where request_id = ${own.id}`,
  ).toHaveLength(0);
});

test("IDOR записи и чтения: Анна не записывается на заявку Тимура, а Сегодня содержит только её талон", async ({
  page,
  pickupData: f,
}) => {
  const id = await f.ready(),
    foreign = await prepare(f, f.timur, f.foreignWindowId);
  const state = await f.getPickup.execute(f.anna, { id });
  const slotStartsAt = state.windows
    .find((window) => window.id === f.windowId)
    ?.slots.at(-1);
  if (!slotStartsAt) throw new Error("Нет свободного слота");
  await loginAsTestStudent(page, f.studentCredentials.anna);
  await page.goto(`/requests/${id}`);
  const card = page.getByTestId("pickup-card");
  await expect(card).toHaveAttribute("data-ready", "true");
  await card
    .getByLabel("Окно выдачи", { exact: true })
    .selectOption(f.windowId);
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(slotStartsAt));
  const datePart = (type: string) =>
    dateParts.find((part) => part.type === type)?.value ?? "";
  const date = `${datePart("year")}-${datePart("month")}-${datePart("day")}`;
  await card.getByLabel("Дата получения", { exact: true }).selectOption(date);
  await card
    .getByLabel("Время получения (МСК)", { exact: true })
    .selectOption(slotStartsAt);
  const capture = page.waitForRequest(
    (request) =>
      request.method() === "POST" && Boolean(request.headers()["next-action"]),
  );
  await card
    .getByRole("button", { name: "Записаться на получение", exact: true })
    .click();
  const action = (await capture).headers()["next-action"];
  if (!action) throw new Error("Не найден Server Action записи");
  await expect(page.getByTestId("pickup-ticket")).toBeVisible();
  const foreignRows =
    await f.sql`select id, status, slot_starts_at, ticket_no from pickup_bookings where request_id = ${foreign.id}`;
  const foreignRequest =
    await f.sql`select status, updated_at from requests where id = ${foreign.id}`;
  const foreignSlot = (await f.getPickup.execute(f.timur, { id: foreign.id }))
    .booking?.slotStartsAt;
  if (!foreignSlot) throw new Error("Нет чужого талона");
  const attack = await page.request.post(`/requests/${id}`, {
    headers: headers(page, action),
    data: JSON.stringify([
      {
        id: foreign.id,
        windowId: f.foreignWindowId,
        slotStartsAt: foreignSlot,
      },
    ]),
  });
  expect(attack.status()).toBe(404);
  expect(await attack.text()).not.toContain(f.foreignMarker);
  const ownRows =
    await f.sql`select id, status, slot_starts_at, ticket_no from pickup_bookings where request_id = ${id}`;
  const badOrigin = await page.request.post(`/requests/${id}`, {
    headers: headers(page, action, "https://foreign.invalid"),
    data: JSON.stringify([{ id, windowId: f.windowId, slotStartsAt }]),
  });
  expect([403, 500]).toContain(badOrigin.status());
  await badOrigin.text();
  const missingOrigin = await page.request.post(`/requests/${id}`, {
    headers: headers(page, action, null),
    data: JSON.stringify([{ id, windowId: f.windowId, slotStartsAt }]),
  });
  expect(await missingOrigin.text()).toContain('"code":"FORBIDDEN"');
  expect(
    await f.sql`select id, status, slot_starts_at, ticket_no from pickup_bookings where request_id = ${id}`,
  ).toEqual(ownRows);
  expect(
    await f.sql`select id, status, slot_starts_at, ticket_no from pickup_bookings where request_id = ${foreign.id}`,
  ).toEqual(foreignRows);
  expect(
    await f.sql`select status, updated_at from requests where id = ${foreign.id}`,
  ).toEqual(foreignRequest);
  expect(
    await f.sql`select id from request_events where request_id = ${foreign.id}`,
  ).toHaveLength(0);
  expect(
    await f.sql`select id from staff_audit_log where request_id = ${foreign.id}`,
  ).toHaveLength(0);
  const today = await page.request.get("/today", {
    headers: { Accept: "text/html" },
  });
  expect(today.status()).toBe(200);
  const body = await today.text();
  expect(body).toContain(`/requests/${id}`);
  expect(body).toContain(f.marker);
  expect(body).not.toContain(`/requests/${foreign.id}`);
  expect(body).not.toContain(f.foreignMarker);
});
