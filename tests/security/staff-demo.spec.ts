import { test as base, expect } from "@playwright/test";
import { staffCommentOptions } from "@/application/staff/dto";
import {
  type DemoStaffFixture,
  openDemoStaffFixture,
} from "../integration/staff-demo-fixture";
import { loginAsTestStaff } from "./staff-login";

const test = base.extend<{ demoStaff: DemoStaffFixture }>({
  demoStaff: async ({ baseURL }, use) => {
    base.skip(!process.env.DATABASE_URL, "Нужна тестовая БД.");
    if (!baseURL) throw new Error("Укажите адрес приложения.");
    const fixture = await openDemoStaffFixture();
    try {
      await use(fixture);
    } finally {
      await fixture.close();
    }
  },
});

for (const to of ["needs_info", "rejected"] as const)
  test(`демо-сотрудник: прямой Server Action ${to} отклоняет текст, принимает только код`, async ({
    page,
    demoStaff: fixture,
  }) => {
    const id = await fixture.request();
    await loginAsTestStaff(page, fixture.marinaCredentials);
    await page.goto(`/staff/requests/${id}`);
    const capture = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        Boolean(request.headers()["next-action"]),
    );
    await page.getByRole("button", { name: "Принять", exact: true }).click();
    const action = (await capture).headers()["next-action"];
    await expect(page.locator("[aria-current=step]")).toContainText("Принята");
    await page.getByRole("button", { name: "В работу", exact: true }).click();
    await expect(page.locator("[aria-current=step]")).toContainText("В работе");
    const before = await fixture.get.execute(fixture.marina, { id });
    const option = staffCommentOptions[to][0];
    const headers = {
      "Next-Action": action ?? "",
      "Content-Type": "application/json",
      Origin: new URL(page.url()).origin,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
    };
    for (const fields of [
      { comment: "Текст постороннего посетителя" },
      { comment: option.label },
      { commentCode: "not_in_list" },
      {
        commentCode:
          staffCommentOptions[
            to === "needs_info" ? "rejected" : "needs_info"
          ][0].code,
      },
      { commentCode: option.code, comment: "Подмена" },
    ]) {
      const response = await page.request.post(`/staff/requests/${id}`, {
        headers,
        data: JSON.stringify([{ id, to, ...fields }]),
      });
      expect(await response.text()).toContain('"code":"VALIDATION"');
      expect(await fixture.get.execute(fixture.marina, { id })).toEqual(before);
    }
    const response = await page.request.post(`/staff/requests/${id}`, {
      headers,
      data: JSON.stringify([{ id, to, commentCode: option.code }]),
    });
    expect(response.status()).toBe(200);
    const after = await fixture.get.execute(fixture.marina, { id });
    expect(after.status).toBe(to);
    expect(after.events.at(-1)?.comment).toBe(option.label);
    expect(JSON.stringify(after)).not.toContain(
      "Текст постороннего посетителя",
    );
  });
