import { expect, test } from "@playwright/test";
import { loginAs } from "./login";

test("Анна: ICS Тимура → 404, подмена query и Server Action не меняет чужую подписку", async ({
  browser,
  page,
  request,
}, info) => {
  test.skip(
    info.project.name !== "desktop",
    "Проверка изменяет одну подписку на студента и выполняется один раз.",
  );
  const other = await browser.newContext();
  try {
    const timur = await other.newPage();
    await loginAs(timur, "timur");
    await timur.goto("/schedule");
    await timur.getByRole("button", { name: "Получить новую ссылку" }).click();
    const foreignInput = timur.getByLabel("Ссылка для подписки");
    await expect(foreignInput).toHaveValue(/\/api\/calendar\/[\w-]{43}$/);
    const foreign = await foreignInput.inputValue();
    await loginAs(page, "anna");
    const forbidden = await page.request.get(foreign);
    expect(forbidden.status()).toBe(404);
    expect(await forbidden.text()).not.toContain("Основы маркетинга");
    const original = await other.request.get(foreign);
    expect(original.status()).toBe(200);
    for (const query of ["studentId=timur", "groupId=imp", "token=foreign"]) {
      await page.goto(`/schedule?${query}`);
      await expect(
        page.getByRole("heading", { name: /не найдена/i }),
      ).toBeVisible();
      await expect(
        page.getByText("Основы маркетинга", { exact: true }),
      ).toHaveCount(0);
      expect((await page.request.get(`${foreign}?${query}`)).status()).toBe(
        404,
      );
    }
    await page.goto("/schedule");
    const form = page.locator("form").last();
    // React re-renders a form whose DOM was changed before hydration and drops the injected field.
    await expect
      .poll(() =>
        form.evaluate((element) =>
          Object.keys(element).some((key) => key.startsWith("__reactFiber")),
        ),
      )
      .toBe(true);
    await form.evaluate((element, token) => {
      const input = document.createElement("input");
      input.name = "token";
      input.value = token;
      element.append(input);
    }, new URL(foreign).pathname.split("/").at(-1) ?? "");
    await page.getByRole("button", { name: "Получить новую ссылку" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Объект не найден",
    );
    expect((await other.request.get(foreign)).status()).toBe(200);
    expect((await request.get(foreign)).status()).toBe(200);
    await page.goto("/schedule");
    await page.getByRole("button", { name: "Получить новую ссылку" }).click();
    await expect(page.getByLabel("Ссылка для подписки")).toHaveValue(
      /\/api\/calendar\/[\w-]{43}$/,
    );
    const own = await page.getByLabel("Ссылка для подписки").inputValue();
    expect((await other.request.get(own)).status()).toBe(404);
    const calendar = await request.get(own);
    expect(calendar.status()).toBe(200);
    expect(calendar.headers()["cache-control"]).toContain("no-store");
    expect(await calendar.text()).toContain("BEGIN:VCALENDAR");
    await page.getByRole("button", { name: "Перевыпустить ссылку" }).click();
    await expect(page.getByLabel("Ссылка для подписки")).not.toHaveValue(own);
    expect((await request.get(own)).status()).toBe(404);
  } finally {
    await other.close();
  }
});

test("неизвестный токен и невалидная неделя не раскрывают данных", async ({
  page,
  request,
}) => {
  expect((await request.get(`/api/calendar/${"x".repeat(43)}`)).status()).toBe(
    404,
  );
  await loginAs(page, "anna");
  await page.goto("/schedule?week=2025-W53");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Не удалось выбрать неделю",
  );
  await page.getByRole("link", { name: "К расписанию на сегодня" }).click();
  await expect(page).toHaveURL(/\/schedule$/);
  await expect(
    page.getByRole("heading", { name: "Расписание", exact: true, level: 1 }),
  ).toBeVisible();
});
