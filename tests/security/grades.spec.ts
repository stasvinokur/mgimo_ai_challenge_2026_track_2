import { expect, test } from "./student-login";

test("IDOR: строгий 404 чужой дисциплины; query не подменяет владельца и params", async ({
  page,
  loginAs,
}) => {
  await loginAs("timur");
  await page.goto("/grades");
  const timurHref = await page
    .getByTestId("grade-course")
    .first()
    .getByRole("link", { name: /^Подробнее/ })
    .getAttribute("href");
  await page.goto("/profile");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await loginAs("anna");
  await page.goto("/grades");
  const annaHref = await page
    .getByTestId("grade-course")
    .first()
    .getByRole("link", { name: /^Подробнее/ })
    .getAttribute("href");
  if (!annaHref || !timurHref) throw new Error("Нет дисциплин демо-набора.");

  async function checkForeign(
    foreign: string,
    own: string,
    foreignTitle: string,
    foreignOnlyTitle: string,
  ) {
    const foreignId = foreign.split("/").at(-1) ?? "";
    for (const path of [
      foreign,
      `${foreign}?courseId=${own.split("/").at(-1)}`,
    ]) {
      const response = await page.request.get(path);
      expect(response.status()).toBe(404);
      expect(await response.text()).not.toContain(foreignTitle);
    }
    for (const path of [
      `${foreign}/data`,
      `${foreign}/data?courseId=${own.split("/").at(-1)}`,
    ]) {
      const response = await page.request.get(path);
      expect(response.status()).toBe(404);
      expect(await response.json()).toEqual({
        error: { code: "NOT_FOUND", message: "Объект не найден." },
      });
    }
    for (const query of [
      "utm_source=x",
      "studentId=timur&userId=timur&groupId=imp",
      `courseId=${foreignId}`,
    ]) {
      const list = await page.request.get(`/grades?${query}`);
      expect(list.status()).toBe(200);
      expect(await list.text()).not.toContain(foreignOnlyTitle);
      const detail = await page.request.get(`${own}?${query}`);
      expect(detail.status()).toBe(200);
      const baseline = await (await page.request.get(`${own}/data`)).json();
      const data = await page.request.get(`${own}/data?${query}`);
      expect(data.status()).toBe(200);
      expect(await data.json()).toEqual(baseline);
    }
    const tree = [
      "",
      {
        children: [
          "(student)",
          {
            children: [
              "grades",
              {
                children: [
                  ["courseId", foreignId, "d", null],
                  { children: ["__PAGE__", {}, null, "refetch"] },
                ],
              },
            ],
          },
        ],
      },
    ];
    const headers = {
      RSC: "1",
      "Next-Router-State-Tree": encodeURIComponent(JSON.stringify(tree)),
    };
    let flight = await page.request.get(foreign, { headers, maxRedirects: 0 });
    if (flight.status() === 307) {
      const destination = new URL(
        flight.headers().location ?? "",
        flight.url(),
      );
      expect(destination.pathname).toBe(foreign);
      flight = await page.request.get(destination.toString(), {
        headers,
        maxRedirects: 0,
      });
    }
    expect(flight.headers()["content-type"]).toContain("text/x-component");
    const payload = await flight.text();
    expect(payload).toMatch(/"digest":"NEXT_HTTP_ERROR_FALLBACK;404"/);
    expect(payload).not.toContain(foreignTitle);
    const response = await page.goto(foreign);
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "Страница не найдена", exact: true }),
    ).toBeVisible();
  }
  await checkForeign(
    timurHref,
    annaHref,
    "Основы маркетинга",
    "Основы маркетинга",
  );
  await page.goto("/profile");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await loginAs("timur");
  await checkForeign(
    annaHref,
    timurHref,
    "Иностранный язык",
    "История международных отношений",
  );
});

test("несуществующая и невалидная дисциплины: HTTP 404 для HTML и JSON", async ({
  page,
  loginAs,
}) => {
  await loginAs("anna");
  const errors = [];
  for (const id of ["00000000-0000-7000-8000-000000ffffee", "invalid"]) {
    const html = await page.request.get(`/grades/${id}`);
    expect(html.status()).toBe(404);
    const json = await page.request.get(`/grades/${id}/data`);
    expect(json.status()).toBe(404);
    errors.push(await json.json());
  }
  expect(errors[0]).toEqual(errors[1]);
});

test("сотрудник не получает студенческие данные через список и JSON", async ({
  page,
  loginAs,
}) => {
  await loginAs("anna");
  await page.goto("/grades");
  const href = await page
    .getByTestId("grade-course")
    .first()
    .getByRole("link", { name: /^Подробнее/ })
    .getAttribute("href");
  if (!href) throw new Error("Нет дисциплины.");
  await page.goto("/profile");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await loginAs("marina");
  for (const path of ["/grades", `${href}/data`]) {
    const response = await page.request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(
      new URL(response.headers().location ?? "", response.url()).pathname,
    ).toBe("/staff/requests");
    expect(await response.text()).not.toMatch(
      /Иностранный язык|Предполагаемый балл|"works"/,
    );
  }
  await page.goto("/grades");
  await expect(page).toHaveURL(/\/staff\/requests$/);
  await expect(page.getByRole("main")).not.toContainText("Как у меня дела");
});

test("аноним не читает JSON дисциплины", async ({ request }) => {
  const response = await request.get(
    "/grades/00000000-0000-7000-8000-000000ffffee/data",
    { maxRedirects: 0 },
  );
  expect(response.status()).toBe(307);
  expect(response.headers().location).toContain("/login");
});
