import { test as base, expect } from "@playwright/test";
import {
  type EventRequestFixture,
  openEventRequestFixture,
} from "../integration/requests-event-data";
import { loginAsTestStaff } from "./staff-login";
import { loginAsTestStudent } from "./student-login";

const test = base.extend<{ eventData: EventRequestFixture }>({
  eventData: async ({ baseURL }, use) => {
    base.skip(!process.env.DATABASE_URL, "Нужна БД лейна");
    if (!baseURL) throw new Error("Укажите адрес приложения");
    const f = await openEventRequestFixture();
    try {
      await use(f);
    } finally {
      await f.close();
    }
  },
});
test("мероприятие: чужая заявка и чужой факультет дают 404 по URL и настоящему Server Action", async ({
  page,
  eventData: f,
}) => {
  const annaRequest = await f.createEvent();
  const foreignRequest = await f.createEvent(true, f.timur);
  await loginAsTestStudent(page, f.studentCredentials.timur);
  const response = await page.goto(`/requests/${annaRequest}`);
  expect(response?.status()).toBe(404);
  expect(await response?.text()).not.toContain(f.payload.eventName);
  await loginAsTestStaff(page, f.limitedCredentials);
  const hidden = await page.goto(`/staff/requests/${foreignRequest}`);
  expect(hidden?.status()).toBe(404);
  expect(await hidden?.text()).not.toContain(f.payload.eventName);
  await page.goto(`/staff/requests/${annaRequest}`);
  const capture = page.waitForRequest(
    (request) =>
      request.method() === "POST" && Boolean(request.headers()["next-action"]),
  );
  await page.getByRole("button", { name: "Принять", exact: true }).click();
  const action = (await capture).headers()["next-action"];
  await expect(
    page.getByRole("main").getByText("Принята", { exact: true }).first(),
  ).toBeVisible();
  const attack = await page.request.post(`/staff/requests/${foreignRequest}`, {
    headers: {
      "Next-Action": action ?? "",
      "Content-Type": "application/json",
      Origin: new URL(page.url()).origin,
      "Sec-Fetch-Site": "same-origin",
    },
    data: JSON.stringify([{ id: foreignRequest, to: "ready" }]),
  });
  expect(attack.status()).toBe(404);
  expect(await attack.text()).not.toContain(f.payload.eventName);
  expect(
    await f.sql`select id from attendance_records where source_key = ${`event:${foreignRequest}`}`,
  ).toHaveLength(0);
});

test("список клиента игнорируется, а период больше 14 дней отклоняется настоящим Server Action", async ({
  page,
  eventData: f,
}) => {
  await loginAsTestStudent(page, f.studentCredentials.anna);
  await page.goto("/requests/new?type=event_release");
  const capture = page.waitForRequest(
    (request) =>
      request.method() === "POST" && Boolean(request.headers()["next-action"]),
  );
  await page
    .getByRole("button", { name: "Сохранить черновик", exact: true })
    .click();
  const action = (await capture).headers()["next-action"];
  await expect(
    page.getByText("Черновик сохранён. Он доступен в разделе «Заявки»."),
  ).toBeVisible();
  const headers = {
    "Next-Action": action ?? "",
    "Content-Type": "application/json",
    Origin: new URL(page.url()).origin,
    "Sec-Fetch-Site": "same-origin",
  };
  const forged = await page.request.post("/requests/new?type=event_release", {
    headers,
    data: JSON.stringify([
      {
        typeCode: "event_release",
        review: true,
        payload: {
          ...f.payload,
          eventLessons: [{ slotId: "forged", occurrenceDate: "2026-11-09" }],
        },
      },
    ]),
  });
  expect(forged.status()).toBe(200);
  expect(await forged.text()).not.toContain("forged");
  if (f.anna.kind !== "student") throw new Error("Нужен студент");
  const rows =
    await f.sql`select id, payload from requests where student_id = ${f.anna.studentId} and payload->>'eventName' = ${f.payload.eventName}`;
  expect(rows).toHaveLength(1);
  expect(rows[0]?.payload).not.toHaveProperty("eventLessons");
  const invalid = await page.request.post("/requests/new?type=event_release", {
    headers,
    data: JSON.stringify([
      {
        typeCode: "event_release",
        review: true,
        payload: { ...f.payload, dateFrom: "2026-11-01", dateTo: "2026-11-15" },
      },
    ]),
  });
  expect(await invalid.text()).toContain("VALIDATION");
  await page.goto(`/requests/${rows[0]?.id}`);
  await page
    .getByRole("button", { name: "Проверить заявку", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Пары на время мероприятия" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Подтвердить отправку", exact: true })
    .click();
  await expect(
    page.getByRole("main").getByText("Подана", { exact: true }).first(),
  ).toBeVisible();
  const [saved] =
    await f.sql`select payload from requests where id = ${rows[0]?.id}`;
  expect(saved?.payload.eventLessons).toEqual(
    await f.preview.execute(f.anna, {
      dateFrom: f.payload.dateFrom,
      dateTo: f.payload.dateTo,
    }),
  );
});

for (const from of ["submitted", "in_progress"] as const)
  test(`студент не одобряет свою заявку из ${from}: 403 без отметок, баллов и уведомлений`, async ({
    page,
    eventData: f,
  }) => {
    if (f.anna.kind !== "student") throw new Error("Нужен студент");
    const probeId = await f.createEvent();
    await loginAsTestStudent(page, f.studentCredentials.anna);
    await page.goto(`/requests/${probeId}`);
    await page
      .getByRole("button", { name: "Отменить заявку", exact: true })
      .click();
    const capture = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        Boolean(request.headers()["next-action"]),
    );
    await page
      .getByRole("button", { name: "Подтвердить отмену", exact: true })
      .click();
    const action = (await capture).headers()["next-action"];
    expect(action).toBeTruthy();
    await expect(
      page
        .locator('[data-slot="badge"]')
        .filter({ hasText: /^Отменена$/ })
        .first(),
    ).toBeVisible();
    const id = await f.createEvent();
    if (from === "in_progress") await f.progress(id);
    await page.goto(`/requests/${id}`);
    await expect(
      page
        .locator('[data-slot="badge"]')
        .filter({ hasText: from === "submitted" ? /^Подана$/ : /^В работе$/ })
        .first(),
    ).toBeVisible();
    const beforeEvents = (
      await f.sql`select id from request_events where request_id = ${id}`
    )
      .map((row) => row.id)
      .sort();
    const beforeNotifications = (
      await f.sql`select id from notifications where link = ${`/requests/${id}`}`
    )
      .map((row) => row.id)
      .sort();
    const response = await page.request.post(`/requests/${id}`, {
      headers: {
        "Next-Action": action ?? "",
        "Content-Type": "application/json",
        Accept: "text/x-component",
        Origin: new URL(page.url()).origin,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
      },
      data: JSON.stringify([{ id, to: "ready" }]),
    });
    const body = await response.text();
    expect(body).toContain('"status":403');
    expect(body).toContain('"code":"FORBIDDEN"');
    expect((await f.get.execute(f.anna, { id })).status).toBe(from);
    expect(
      await f.sql`select id from attendance_records where student_id = ${f.anna.studentId}`,
    ).toHaveLength(0);
    expect(
      await f.sql`select id from activity_points where student_id = ${f.anna.studentId}`,
    ).toHaveLength(0);
    expect(
      (await f.sql`select id from request_events where request_id = ${id}`)
        .map((row) => row.id)
        .sort(),
    ).toEqual(beforeEvents);
    expect(
      (
        await f.sql`select id from notifications where link = ${`/requests/${id}`}`
      )
        .map((row) => row.id)
        .sort(),
    ).toEqual(beforeNotifications);
  });
