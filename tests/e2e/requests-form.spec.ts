import { randomUUID } from "node:crypto";
import { cleanupRequestsForTest } from "../integration/requests-e2e-cleanup";
import { test as base, expect } from "../security/student-login";

const test = base.extend<{ destinations: { initial: string; edited: string } }>(
  {
    destinations: async ({ baseURL }, use) => {
      if (!baseURL)
        throw new Error("Для проверки заявок укажите адрес приложения.");
      const initial = `Учебный центр «Горизонт» · ${randomUUID()}`;
      const edited = `${initial} · новые правки`;
      try {
        await use({ initial, edited });
      } finally {
        await cleanupRequestsForTest(initial);
        await cleanupRequestsForTest(edited);
      }
    },
  },
);

for (const action of ["Сохранить черновик", "Проверить заявку"])
  test(`медленный ответ «${action}» сохраняет правки без дубликата черновика`, async ({
    page,
    loginAs,
    destinations,
  }) => {
    await loginAs("timur");
    await page.goto("/requests/new?type=enrollment");
    const field = page.getByLabel("Место требования (обязательно)");
    const status = page.getByRole("main").getByRole("status");
    await field.fill(destinations.initial);
    const saveResponse = Promise.withResolvers<void>();
    const submitResponse = Promise.withResolvers<void>();
    const inputs: unknown[] = [];
    let heldResponses = 0;
    await page.route(
      (url) => url.pathname === "/requests/new",
      async (route) => {
        const request = route.request();
        if (request.method() !== "POST" || !request.headers()["next-action"])
          return route.continue();
        inputs.push(JSON.parse(request.postData() ?? "[]")[0]);
        const index = inputs.length;
        const response = await route.fetch();
        if (index === 1 || index === 4) {
          heldResponses++;
          await (index === 1 ? saveResponse : submitResponse).promise;
        }
        await route.fulfill({ response });
      },
    );
    try {
      await page.getByRole("button", { name: action, exact: true }).dblclick();
      await expect.poll(() => heldResponses).toBe(1);
      await expect(page.locator("form[aria-busy]")).toHaveAttribute(
        "aria-busy",
        "true",
      );
      await expect(field).toBeEditable();
      await field.fill(destinations.edited);
      await expect(status).toContainText("Есть несохранённые изменения");
      saveResponse.resolve();
      await expect(page.locator("form[aria-busy]")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await expect(field).toHaveValue(destinations.edited);
      await expect(status).toContainText("Есть несохранённые изменения");
      await expect(
        page.getByRole("heading", { name: "Проверьте заявку", exact: true }),
      ).toHaveCount(0);
      expect(inputs).toHaveLength(1);

      await page
        .getByRole("button", { name: "Сохранить черновик", exact: true })
        .click();
      await expect(status).toContainText("Черновик сохранён");
      const savedLink = page.getByRole("link", {
        name: "Открыть сохранённый черновик",
        exact: true,
      });
      await expect(savedLink).toHaveAttribute(
        "href",
        /^\/requests\/[0-9a-f-]{36}$/,
      );
      const path = await savedLink.getAttribute("href");
      const id = path?.split("/").at(-1);
      expect(inputs).toHaveLength(2);
      expect(inputs[0]).not.toHaveProperty("id");
      expect(inputs[1]).toMatchObject({
        id,
        payload: { destination: destinations.edited },
      });

      await page
        .getByRole("button", { name: "Проверить заявку", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Проверьте заявку", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(destinations.edited, { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Подтвердить отправку", exact: true })
        .dblclick();
      await expect.poll(() => heldResponses).toBe(2);
      await expect(
        page.getByRole("button", { name: "Отправляем…", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Изменить данные", exact: true }),
      ).toBeDisabled();
      submitResponse.resolve();
      await expect(page).toHaveURL(new RegExp(`/requests/${id}$`));
      await expect(page.getByText("Подана", { exact: true })).toBeVisible();
      await expect(
        page.getByText(destinations.edited, { exact: true }),
      ).toBeVisible();
      expect(inputs).toHaveLength(4);
      expect(inputs[3]).toBe(id);
      await page.goto("/requests");
      await expect(
        page.locator("li").filter({ has: page.locator(`a[href="${path}"]`) }),
      ).toHaveCount(1);
    } finally {
      saveResponse.resolve();
      submitResponse.resolve();
      await page.unrouteAll({ behavior: "wait" });
    }
  });
