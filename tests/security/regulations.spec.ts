import { expect, test } from "./student-login";

test("положения доступны только студенту; неизвестный slug — настоящий 404", async ({
  page,
  loginAs,
  request,
}) => {
  for (const path of ["/regulations", "/regulations/scholarship"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toContain("/login");
  }
  await loginAs("anna");
  const response = await page.goto("/regulations/unknown-document");
  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: /не найдена/i }),
  ).toBeVisible();
  for (const name of ["studentId", "userId", "groupId"]) {
    const forged = await page.request.get(
      `/regulations/scholarship?${name}=timur`,
    );
    expect(forged.status()).toBe(404);
    expect(await forged.text()).not.toContain("Все итоги дисциплин");
  }
});

test("сотрудник не получает документ даже через RSC", async ({
  page,
  loginAs,
}) => {
  await loginAs("marina");
  await page.goto("/regulations/scholarship");
  await expect(page).toHaveURL(/\/staff\/requests$/);
  const response = await page.request.get("/regulations/scholarship", {
    maxRedirects: 0,
    headers: {
      RSC: "1",
      "Next-Router-State-Tree": encodeURIComponent(
        JSON.stringify([
          "",
          {
            children: [
              "(student)",
              { children: ["regulations", { children: ["scholarship", {}] }] },
            ],
          },
        ]),
      ),
    },
  });
  expect(await response.text()).not.toContain(
    "Академическая стипендия назначается",
  );
});
