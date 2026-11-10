import { createSearchRequest } from "../integration/search-data";
import { openStaffFixture } from "../integration/staff-fixtures";
import { loginAsTestStaff } from "./staff-login";
import { expect, test } from "./student-login";

test("поиск Анны не находит заявку и дисциплину Тимура, а поиск Тимура находит; query не меняет владельца", async ({
  page,
  students,
  loginAs,
}) => {
  const timur = await students.get("timur");
  const foreign = await createSearchRequest(timur.actor.studentId);
  const numberQueries = [foreign.publicNo, foreign.publicNo.slice(-8)];
  await loginAs("anna");
  for (const q of [...numberQueries, "Основы маркетинга"]) {
    for (const forged of [false, true]) {
      const params = new URLSearchParams({ q });
      if (forged) {
        params.set("studentId", timur.actor.studentId);
        params.set("userId", timur.actor.userId);
        params.set("faculty", timur.actor.facultyId);
      }
      const response = await page.goto(`/search?${params}`);
      expect(response?.status()).toBe(200);
      await expect(
        page.getByRole("heading", { name: "Ничего не найдено", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("region", { name: "Результаты поиска" }),
      ).toHaveCount(0);
      await expect(
        page.locator(`a[href="/requests/${foreign.id}"]`),
      ).toHaveCount(0);
    }
  }
  await page.goto(
    `/search?${new URLSearchParams({ q: "география", studentId: timur.actor.studentId, userId: timur.actor.userId })}`,
  );
  await expect(
    page.getByRole("region", { name: "Расписание", exact: true }),
  ).toContainText("Политическая география");
  await expect(
    page.getByRole("region", { name: "Результаты поиска" }),
  ).not.toContainText("Основы маркетинга");
  await page.goto("/profile");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await loginAs("timur");
  for (const q of numberQueries) {
    const response = await page.goto(`/search?${new URLSearchParams({ q })}`);
    expect(response?.status()).toBe(200);
    await expect(
      page
        .getByRole("region", { name: "Заявки", exact: true })
        .locator(`a[href="/requests/${foreign.id}"]`),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Ничего не найдено", exact: true }),
    ).toHaveCount(0);
  }
  const response = await page.goto(
    `/search?${new URLSearchParams({ q: "Основы маркетинга" })}`,
  );
  expect(response?.status()).toBe(200);
  const course = page
    .getByRole("region", { name: "Учёба", exact: true })
    .getByRole("link")
    .filter({ hasText: "Основы маркетинга" })
    .first();
  await expect(course).toBeVisible();
  await expect(course).toHaveAttribute("href", /^\/grades\/[0-9a-f-]{36}$/);
});

test("сотрудник перенаправляется в свой кабинет на HTML и через поддельное RSC-дерево без результатов поиска", async ({
  page,
}) => {
  const f = await openStaffFixture();
  try {
    await loginAsTestStaff(page, f.limitedCredentials);
    await expect(
      page.getByLabel("Поиск по кабинету", { exact: true }),
    ).toHaveCount(0);
    const response = await page.request.get("/search?q=география", {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(307);
    const destination = new URL(
      response.headers().location ?? "",
      response.url(),
    );
    expect(destination.origin).toBe(new URL(response.url()).origin);
    expect(destination.pathname).toBe("/staff/requests");
    const flightHeaders = {
      RSC: "1",
      "Next-Router-State-Tree": encodeURIComponent(
        JSON.stringify([
          "",
          {
            children: [
              "(student)",
              {
                children: [
                  "search",
                  { children: ["__PAGE__", {}, null, "refetch"] },
                ],
              },
            ],
          },
        ]),
      ),
    };
    async function getFlight(url: string) {
      try {
        return await page.request.get(url, {
          maxRedirects: 0,
          headers: flightHeaders,
        });
      } catch {
        throw new Error("Не удалось выполнить HTTP-проверку RSC.");
      }
    }
    let flight = await getFlight("/search?q=география");
    if (flight.status() === 307) {
      const cacheKey = new URL(flight.headers().location ?? "", flight.url());
      if (
        cacheKey.pathname === new URL(flight.url()).pathname &&
        cacheKey.searchParams.has("_rsc")
      ) {
        expect(cacheKey.origin).toBe(new URL(flight.url()).origin);
        flight = await getFlight(cacheKey.toString());
      }
    }
    expect([200, 307]).toContain(flight.status());
    if (flight.status() === 307) {
      const redirected = new URL(flight.headers().location ?? "", flight.url());
      expect(redirected.origin).toBe(new URL(flight.url()).origin);
      expect(redirected.pathname).toBe("/staff/requests");
    } else {
      expect(flight.headers()["content-type"]).toContain("text/x-component");
      expect(await flight.text()).toContain(
        "NEXT_REDIRECT;replace;/staff/requests;307;",
      );
    }
    for (const denied of [response, flight]) {
      const payload = await denied.text();
      expect(payload).not.toContain("Политическая география");
      expect(payload).not.toContain("Результаты поиска");
      expect(payload).not.toContain("search-schedule");
      expect(payload).not.toContain(f.anna.studentId);
      expect(payload).not.toContain(f.timur.studentId);
      expect(payload).not.toMatch(/Анна Соколова|Тимур Белов|З-\d{4}-\d{6}/);
    }
    await page.goto("/search?q=география");
    await expect(page).toHaveURL(/\/staff\/requests$/);
    await expect(page.getByRole("main")).not.toContainText("Результаты поиска");
  } finally {
    await f.close();
  }
});

test("аноним перенаправляется на вход", async ({ request }) => {
  const response = await request.get("/search?q=география", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toContain("/login");
  expect(await response.text()).not.toContain("Политическая география");
});
