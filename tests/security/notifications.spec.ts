import { expect } from "@playwright/test";
import { test } from "../integration/notifications-e2e-data";

test.setTimeout(90_000);
test("IDOR actions, изоляция пульса, 401/403 и защита от внешних ссылок", async ({
  page,
  loginAs,
  students,
  browser,
  request,
  notificationsData,
  notificationTitle,
}) => {
  const ownId = await notificationsData.insert({ title: notificationTitle });
  const foreignTitle = `${notificationTitle} · другое`;
  const foreignId = await notificationsData.insert({
    title: foreignTitle,
    userId: (await students.get("timur")).actor.userId,
  });
  const unsafeIds = [];
  for (const link of ["//evil.example", "https://evil.example"])
    unsafeIds.push(
      await notificationsData.insert({
        title: `${notificationTitle} · ${link}`,
        link,
      }),
    );
  await loginAs("anna");
  await page.goto(
    `/notifications?userId=timur&studentId=timur&id=${foreignId}`,
  );
  await expect(page.getByText(foreignTitle, { exact: true })).toHaveCount(0);
  const own = page.locator(`[data-notification-id='${ownId}']`);
  const capturedPromise = page.waitForRequest(
    (req) => req.method() === "POST" && Boolean(req.headers()["next-action"]),
  );
  await own.getByRole("button", { name: "Прочитано", exact: true }).click();
  const captured = await capturedPromise;
  await expect(own.getByText("Прочитано", { exact: true })).toBeVisible();
  const action = captured.headers()["next-action"];
  expect(action).toBeTruthy();
  const headers = {
    "Next-Action": action ?? "",
    "Content-Type": "application/json",
  };
  const attack = await page.request.post("/notifications", {
    headers,
    data: JSON.stringify([{ id: foreignId }]),
  });
  expect(attack.status()).toBe(404);
  expect(await notificationsData.readAt(foreignId)).toBeNull();
  expect(await attack.text()).not.toContain(foreignTitle);
  for (const id of unsafeIds) {
    await expect(
      page.locator(`[data-notification-id='${id}']`).getByRole("link"),
    ).toHaveCount(0);
    const unsafe = await page.request.post("/notifications", {
      headers,
      data: JSON.stringify([{ id, open: true }]),
    });
    expect(await unsafe.text()).toContain('"code":"VALIDATION"');
    expect(unsafe.headers().location).toBeUndefined();
    expect(unsafe.headers()["x-action-redirect"]).toBeUndefined();
    expect(await notificationsData.readAt(id)).toBeNull();
  }
  const anonymous = await request.get("/api/me/pulse", { maxRedirects: 0 });
  expect(anonymous.status()).toBe(401);
  expect(anonymous.headers().location).toBeUndefined();
  expect(anonymous.headers()["content-type"]).toContain("application/json");
  const other = await browser.newContext();
  try {
    const otherPage = await other.newPage();
    await students.login(otherPage, "timur");
    await otherPage.goto("/notifications");
    await expect(
      otherPage.locator(`[data-notification-id='${ownId}']`),
    ).toHaveCount(0);
    const reverse = await otherPage.request.post("/notifications", {
      headers,
      data: JSON.stringify([{ id: ownId }]),
    });
    expect(reverse.status()).toBe(404);
    const before = await (
      await otherPage.request.get("/api/me/pulse?userId=anna&studentId=anna")
    ).json();
    const inserted = await notificationsData.insert({
      title: `${notificationTitle} · только Анне`,
    });
    expect(inserted).toBeTruthy();
    const pulse = await otherPage.request.get("/api/me/pulse");
    expect(await pulse.json()).toEqual(before);
    expect(Object.keys(before).sort()).toEqual(["latestAt", "unread"]);
    expect(pulse.headers()["cache-control"]).toBe("private, no-store");
    await students.login(otherPage, "marina");
    const staff = await otherPage.request.get("/api/me/pulse", {
      maxRedirects: 0,
    });
    expect(staff.status()).toBe(403);
    expect(await staff.json()).not.toHaveProperty("unread");
  } finally {
    await other.close();
  }
});
