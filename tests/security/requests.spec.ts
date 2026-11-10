import { randomUUID } from "node:crypto";
import { cleanupRequestsForTest } from "../integration/requests-e2e-cleanup";
import { test as base, expect } from "./student-login";

const test = base.extend<{ requestDestination: string }>({
  requestDestination: async ({ baseURL }, use) => {
    if (!baseURL)
      throw new Error("Для проверки заявок укажите адрес приложения.");
    const destination = `Учебный центр «Меридиан» · ${randomUUID()}`;
    try {
      await use(destination);
    } finally {
      await cleanupRequestsForTest(destination);
    }
  },
});

test("IDOR и BFLA: URL, query и поддельные Server Actions", async ({
  page,
  loginAs,
  browser,
  students,
  requestDestination,
}) => {
  const httpStatuses: (number | undefined)[] = [];
  await loginAs("anna");
  await page.goto("/requests/new?type=enrollment");
  await page
    .getByLabel("Место требования (обязательно)")
    .fill(requestDestination);
  await page
    .getByRole("button", { name: "Проверить заявку", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Подтвердить отправку", exact: true })
    .click();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { name: "Что происходит?" }),
  ).toBeVisible();
  const path = new URL(page.url()).pathname;
  const id = path.split("/").at(-1);
  await page
    .getByRole("button", { name: "Отменить заявку", exact: true })
    .click();
  const requestPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" && Boolean(request.headers()["next-action"]),
  );
  await page
    .getByRole("button", { name: "Подтвердить отмену", exact: true })
    .click();
  const captured = await requestPromise;
  await expect(page.getByText("Отменена", { exact: true })).toBeVisible();
  const action = captured.headers()["next-action"];
  expect(action).toBeTruthy();
  // Reuse the real action reference; only attacker-controlled arguments change.
  const foreignContext = await browser.newContext();
  try {
    const foreignPage = await foreignContext.newPage();
    await students.login(foreignPage, "timur");
    const response = await foreignPage.goto(path);
    const body = await response?.text();
    expect(body).not.toContain(requestDestination);
    httpStatuses.push(response?.status());
    await expect(
      foreignPage.getByRole("heading", { name: "Страница не найдена" }),
    ).toBeVisible();
    await expect(
      foreignPage.getByText(requestDestination, { exact: true }),
    ).toHaveCount(0);
    const attack = await foreignPage.request.post(path, {
      headers: {
        "Next-Action": action ?? "",
        "Content-Type": "application/json",
      },
      data: JSON.stringify([{ id, to: "cancelled" }]),
    });
    expect(attack.status()).toBe(404);
    expect(await attack.text()).not.toContain(requestDestination);
    await foreignPage.goto(`/requests?studentId=anna&userId=anna&id=${id}`);
    await expect(foreignPage.locator(`a[href="${path}"]`)).toHaveCount(0);

    // Reverse direction: Anna cannot read or modify Timur's draft either.
    await foreignPage.goto("/requests/new?type=enrollment");
    await foreignPage
      .getByLabel("Место требования (обязательно)")
      .fill(requestDestination);
    await foreignPage
      .getByRole("button", { name: "Сохранить черновик", exact: true })
      .click();
    await foreignPage
      .getByRole("link", { name: "Открыть сохранённый черновик" })
      .click();
    await expect(foreignPage).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
    const timurPath = new URL(foreignPage.url()).pathname;
    const reverse = await page.request.post(timurPath, {
      headers: {
        "Next-Action": action ?? "",
        "Content-Type": "application/json",
      },
      data: JSON.stringify([
        { id: timurPath.split("/").at(-1), to: "cancelled" },
      ]),
    });
    expect(reverse.status()).toBe(404);
    const reversePage = await page.goto(timurPath);
    const reverseBody = await reversePage?.text();
    expect(reverseBody).not.toContain("Данные из профиля");
    httpStatuses.push(reversePage?.status());
  } finally {
    await foreignContext.close();
  }

  // A submitted request is needed so the staff-only transition is otherwise valid.
  await page.goto("/requests/new?type=enrollment");
  await page
    .getByLabel("Место требования (обязательно)")
    .fill(requestDestination);
  await page
    .getByRole("button", { name: "Проверить заявку", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Подтвердить отправку", exact: true })
    .click();
  await expect(page).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Подана", { exact: true })).toBeVisible();
  const ownPath = new URL(page.url()).pathname;
  const ownId = ownPath.split("/").at(-1);
  const forbidden = await page.request.post(ownPath, {
    headers: {
      "Next-Action": action ?? "",
      "Content-Type": "application/json",
    },
    data: JSON.stringify([{ id: ownId, to: "accepted" }]),
  });
  expect(await forbidden.text()).toContain('"code":"FORBIDDEN"');
  const identityInjection = await page.request.post(ownPath, {
    headers: {
      "Next-Action": action ?? "",
      "Content-Type": "application/json",
    },
    data: JSON.stringify([{ id: ownId, to: "cancelled", studentId: "timur" }]),
  });
  expect(await identityInjection.text()).toContain('"code":"VALIDATION"');
  await page.reload();
  await expect(page.getByText("Подана", { exact: true })).toBeVisible();
  for (const status of httpStatuses)
    expect(status, "AC #6: нужен HTTP 404 до начала стриминга").toBe(404);
});
