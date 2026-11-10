import type { APIRequestContext } from "@playwright/test";
import type { SearchDto } from "@/application/search/dto";
import { createSearchRequest } from "../integration/search-data";
import { openStaffFixture } from "../integration/staff-fixtures";
import { loginAsTestStaff } from "./staff-login";
import { expect, test } from "./student-login";
import { loginAsTestTeacher, openTeacherTestData } from "./teacher-login";

async function suggest(
  request: APIRequestContext,
  params: URLSearchParams,
  baseURL: string | undefined,
  rsc = false,
) {
  const options = {
    maxRedirects: 0,
    headers: {
      Origin: new URL(baseURL ?? "http://127.0.0.1:3000").origin,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
      ...(rsc
        ? {
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
          }
        : {}),
    },
  };
  let response = await request.get(`/api/search/suggest?${params}`, options);
  if (rsc && response.status() === 307) {
    const destination = new URL(
      response.headers().location ?? "",
      response.url(),
    );
    if (
      destination.pathname === new URL(response.url()).pathname &&
      destination.searchParams.has("_rsc")
    ) {
      expect(destination.origin).toBe(new URL(response.url()).origin);
      await response.body();
      response = await request.get(destination.href, options);
    }
  }
  expect(response.headers()["cache-control"]).toContain("no-store");
  return response;
}

test("подсказки изолируют данные Анны и Тимура и игнорируют подставленного владельца", async ({
  page,
  students,
  loginAs,
  baseURL,
}) => {
  const timur = await students.get("timur");
  const foreign = await createSearchRequest(timur.actor.studentId);
  await loginAs("anna");
  for (const q of [foreign.publicNo, "Основы маркетинга"]) {
    const clean = await suggest(
      page.request,
      new URLSearchParams({ q }),
      baseURL,
    );
    const params = new URLSearchParams({
      q,
      studentId: timur.actor.studentId,
      userId: timur.actor.userId,
      groupId: "other",
      faculty: timur.actor.facultyId,
    });
    const forged = await suggest(page.request, params, baseURL, true);
    expect(clean.status()).toBe(200);
    expect(forged.status()).toBe(200);
    const result = (await clean.json()) as SearchDto;
    expect(await forged.json()).toEqual(result);
    expect(result.groups.every((group) => group.items.length === 0)).toBe(true);
    expect(JSON.stringify(result.groups)).not.toContain(foreign.id);
  }
  await page.goto("/profile");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await loginAs("timur");
  for (const q of [foreign.publicNo, "Основы маркетинга"]) {
    const response = await suggest(
      page.request,
      new URLSearchParams({ q }),
      baseURL,
    );
    expect(response.status()).toBe(200);
    const result = (await response.json()) as SearchDto;
    const items = result.groups.flatMap((group) => group.items);
    expect(items.length).toBeGreaterThan(0);
    if (q === foreign.publicNo)
      expect(
        items.some((item) => item.href === `/requests/${foreign.id}`),
      ).toBe(true);
    else
      expect(items.some((item) => item.title === "Основы маркетинга")).toBe(
        true,
      );
    for (const group of result.groups)
      expect(group.items.length).toBeLessThanOrEqual(3);
  }
});

test("аноним получает 401 JSON без данных", async ({ request, baseURL }) => {
  const response = await suggest(
    request,
    new URLSearchParams({ q: "география" }),
    baseURL,
  );
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ error: "Требуется вход." });
});

for (const kind of ["staff", "teacher"] as const) {
  test(`${kind}: 403, нет триггера и горячей клавиши`, async ({
    page,
    baseURL,
  }) => {
    test.skip(!process.env.DATABASE_URL, "Нужна БД лейна.");
    const f =
      kind === "staff" ? await openStaffFixture() : await openTeacherTestData();
    try {
      if ("limitedCredentials" in f)
        await loginAsTestStaff(page, f.limitedCredentials);
      else await loginAsTestTeacher(page, f.credentials);
      await expect(
        page.getByRole("link", { name: /Поиск по кабинету/ }),
      ).toHaveCount(0);
      await page.keyboard.press("Control+k");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      for (const rsc of [false, true]) {
        const response = await suggest(
          page.request,
          new URLSearchParams({ q: "география" }),
          baseURL,
          rsc,
        );
        expect(response.status()).toBe(403);
        expect(await response.json()).toEqual({ error: "Нет доступа." });
      }
    } finally {
      await f.close();
    }
  });
}

test("границы схемы и пустой q возвращают 400 no-store", async ({
  page,
  loginAs,
  baseURL,
}) => {
  await loginAs("anna");
  for (const q of [
    "",
    "а",
    "а".repeat(81),
    "\u0000\u0000",
    "\nгеогр",
    "геогр\u0085",
  ]) {
    const response = await suggest(
      page.request,
      new URLSearchParams({ q }),
      baseURL,
    );
    expect(response.status()).toBe(400);
    expect(await response.text()).not.toContain("Политическая география");
  }
});

test("Sec-Fetch-Site отклоняет чужой источник без данных", async ({
  page,
  loginAs,
  baseURL,
}) => {
  await loginAs("anna");
  for (const site of ["cross-site", "same-site", "none"]) {
    const response = await page.request.get("/api/search/suggest?q=геогр", {
      headers: {
        Origin: new URL(baseURL ?? "http://127.0.0.1:3000").origin,
        "Sec-Fetch-Site": site,
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
      },
    });
    expect(response.status()).toBe(403);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await response.json()).toEqual({ error: "Нет доступа." });
  }
});

test("API подсказок принимает не больше 20 параллельных запросов одного пользователя", async ({
  page,
  loginAs,
  baseURL,
}) => {
  await loginAs("anna");
  const responses = await Promise.all(
    Array.from({ length: 30 }, () =>
      suggest(page.request, new URLSearchParams({ q: "геогр" }), baseURL),
    ),
  );
  expect(
    responses.filter((response) => response.status() === 200),
  ).toHaveLength(20);
  expect(
    responses.filter((response) => response.status() === 429),
  ).toHaveLength(10);
  for (const response of responses) {
    const text = await response.text();
    if (response.status() === 429) {
      expect(JSON.parse(text).error.code).toBe("RATE_LIMITED");
      expect(text).not.toContain("Политическая география");
    }
  }
});
