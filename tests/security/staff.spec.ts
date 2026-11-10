import { test as base, expect } from "@playwright/test";
import {
  openStaffFixture,
  type StaffFixture,
} from "../integration/staff-fixtures";
import { loginAs } from "./login";
import { loginAsTestStaff } from "./staff-login";
import { loginAsTestStudent } from "./student-login";

const test = base.extend<{ staffFixture: StaffFixture }>({
  staffFixture: async ({ baseURL }, use) => {
    base.skip(
      !process.env.DATABASE_URL,
      "Нужна тестовая БД для изоляции и очистки данных.",
    );
    if (!baseURL) throw new Error("Укажите адрес приложения.");
    const fixture = await openStaffFixture();
    try {
      await use(fixture);
    } finally {
      await fixture.close();
    }
  },
});

test("студент: staff URL и поддельный Server Action запрещены, включая RSC с пропущенным layout", async ({
  page,
  browser,
  staffFixture: f,
}) => {
  const id = await f.request(f.timur),
    captureId = await f.request();
  await loginAs(page, "marina");
  await page.goto(`/staff/requests/${captureId}`);
  const capture = page.waitForRequest(
    (request) =>
      request.method() === "POST" && !!request.headers()["next-action"],
  );
  await page.getByRole("button", { name: "Принять", exact: true }).click();
  const action = (await capture).headers()["next-action"];
  await expect(page.locator("[aria-current=step]")).toContainText("Принята");
  const context = await browser.newContext();
  try {
    const student = await context.newPage();
    await loginAsTestStudent(student, f.studentCredentials.timur);
    for (const path of [
      "/staff/requests",
      `/staff/requests/${id}`,
      "/staff/profile",
      "/staff",
    ]) {
      const response = await student.goto(path);
      expect(response?.status()).toBe(403);
      expect(await response?.text()).not.toContain(f.marker);
    }
    const denied = await student.request.post(`/staff/requests/${id}`, {
      headers: {
        "Next-Action": action ?? "",
        "Content-Type": "application/json",
      },
      data: JSON.stringify([{ id, to: "accepted" }]),
    });
    expect([403, 404]).toContain(denied.status());
    expect(await denied.text()).not.toContain(f.marker);
    expect((await f.get.execute(f.marina, { id })).status).toBe("submitted");
    expect(
      await f.sql`select id from staff_audit_log where request_id = ${id}`,
    ).toHaveLength(0);
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
                  "requests",
                  {
                    children: [
                      "(list)",
                      { children: ["__PAGE__", {}, null, "refetch"] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
    let rsc = await student.request.get("/staff/requests", {
      headers: {
        RSC: "1",
        "Next-Router-State-Tree": encodeURIComponent(JSON.stringify(tree)),
      },
      maxRedirects: 0,
    });
    if (rsc.status() === 307)
      rsc = await student.request.get(rsc.headers().location ?? "", {
        headers: {
          RSC: "1",
          "Next-Router-State-Tree": encodeURIComponent(JSON.stringify(tree)),
        },
        maxRedirects: 0,
      });
    const body = await rsc.text();
    expect(
      rsc.status() === 403 || body.includes("NEXT_HTTP_ERROR_FALLBACK;403"),
    ).toBe(true);
    expect(body).not.toContain(f.marker);
  } finally {
    await context.close();
  }
});

test("чужой факультет, черновик и неизвестный id: настоящий HTTP 404, события и журнал скрыты", async ({
  page,
  browser,
  baseURL,
  staffFixture: f,
}) => {
  const own = await f.request(),
    foreign = await f.request(f.timur),
    draft = await f.request(f.anna, true);
  await loginAs(page, "marina");
  await page.goto(`/staff/requests/${own}`);
  const capture = page.waitForRequest(
    (request) =>
      request.method() === "POST" && !!request.headers()["next-action"],
  );
  await page.getByRole("button", { name: "Принять", exact: true }).click();
  const action = (await capture).headers()["next-action"];
  await expect(page.locator("[aria-current=step]")).toContainText("Принята");
  const context = await browser.newContext({ baseURL });
  try {
    const limited = await context.newPage();
    await loginAsTestStaff(limited, f.limitedCredentials);
    for (const id of [foreign, draft, f.ids.next(), "unknown"]) {
      const response = await limited.goto(`/staff/requests/${id}`);
      expect(response?.status()).toBe(404);
      expect(await response?.text()).not.toContain(f.marker);
    }
    await limited.goto(
      `/staff/requests?facultyIds=${f.timur.facultyId}&studentId=${f.timur.studentId}`,
    );
    await expect(
      limited.locator(`a[href="/staff/requests/${foreign}"]`),
    ).toHaveCount(0);
    const denied = await limited.request.post(`/staff/requests/${foreign}`, {
      headers: {
        "Next-Action": action ?? "",
        "Content-Type": "application/json",
      },
      data: JSON.stringify([{ id: foreign, to: "accepted" }]),
    });
    expect(denied.status()).toBe(404);
    expect(await denied.text()).not.toContain(f.marker);
    expect((await f.get.execute(f.marina, { id: foreign })).status).toBe(
      "submitted",
    );
    const injection = await page.request.post(`/staff/requests/${own}`, {
      headers: {
        "Next-Action": action ?? "",
        "Content-Type": "application/json",
      },
      data: JSON.stringify([
        { id: own, to: "in_progress", studentId: f.timur.studentId },
      ]),
    });
    expect(await injection.text()).toContain('"code":"VALIDATION"');
    expect((await f.get.execute(f.marina, { id: own })).status).toBe(
      "accepted",
    );
    for (const id of [draft, f.ids.next()])
      expect((await page.goto(`/staff/requests/${id}`))?.status()).toBe(404);
  } finally {
    await context.close();
  }
});
