import type { APIRequestContext } from "@playwright/test";
import type { OnboardingDto } from "@/application/onboarding/get-onboarding";
import { openStaffFixture } from "../integration/staff-fixtures";
import { openStudentTestData } from "../integration/student-e2e-data";
import { loginAsTestStaff } from "./staff-login";
import { expect, loginAsTestStudent, test } from "./student-login";
import { loginAsTestTeacher, openTeacherTestData } from "./teacher-login";

function browserHeaders(baseURL: string | undefined) {
  return {
    Origin: new URL(baseURL ?? "http://127.0.0.1:3000").origin,
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
  };
}

async function progress(request: APIRequestContext) {
  const response = await request.get("/api/me/onboarding");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  return (await response.json()) as OnboardingDto | null;
}

test("аноним получает 401 при чтении, ручной отметке и скрытии", async ({
  page,
  baseURL,
}) => {
  const headers = browserHeaders(baseURL);
  const read = await page.request.get("/api/me/onboarding", {
    headers,
    maxRedirects: 0,
  });
  const readBody = await read.text();
  expect(read.status()).toBe(401);
  expect(read.headers()["cache-control"]).toContain("no-store");
  expect(readBody).not.toContain('"steps"');
  for (const data of [{ stepCode: "schedule" }, { action: "hide" }]) {
    const response = await page.request.post("/api/me/onboarding", {
      headers,
      data,
      maxRedirects: 0,
    });
    const body = await response.text();
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(body).not.toContain('"steps"');
  }
});

test("отметки двух первокурсников изолированы, подмена владельца в URL и теле отклоняется", async ({
  page,
  students,
  baseURL,
}) => {
  const own = await students.get("timur");
  const foreign = await openStudentTestData("timur");
  const headers = browserHeaders(baseURL);
  try {
    await loginAsTestStudent(page, foreign.credentials);
    const foreignMark = await page.request.post("/api/me/onboarding", {
      headers,
      data: { stepCode: "regulations" },
    });
    expect(foreignMark.status()).toBe(200);
    await foreignMark.body();
    await page.goto("/profile");
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await loginAsTestStudent(page, own.credentials);
    const mark = await page.request.post("/api/me/onboarding", {
      headers,
      data: { stepCode: "schedule" },
    });
    expect(mark.status()).toBe(200);
    await mark.body();
    const before = await progress(page.request);
    expect(
      before?.steps.find((step) => step.code === "schedule")?.completed,
    ).toBe(true);
    expect(
      before?.steps.find((step) => step.code === "regulations")?.completed,
    ).toBe(false);
    for (const [key, id] of [
      ["userId", foreign.actor.userId],
      ["studentId", foreign.actor.studentId],
    ] as const) {
      const query = new URLSearchParams({ [key]: id });
      const get = await page.request.get(`/api/me/onboarding?${query}`, {
        headers,
      });
      expect(get.status()).toBe(400);
      expect(await get.text()).not.toContain(id);
      const postQuery = await page.request.post(`/api/me/onboarding?${query}`, {
        headers,
        data: { stepCode: "regulations" },
      });
      expect(postQuery.status()).toBe(400);
      await postQuery.body();
      for (const input of [
        { stepCode: "regulations", [key]: id },
        { action: "hide", [key]: id },
      ]) {
        const post = await page.request.post("/api/me/onboarding", {
          headers,
          data: input,
        });
        expect(post.status()).toBe(400);
        expect(await post.text()).not.toContain(id);
      }
      const direct = await page.request.get(`/api/me/onboarding/${id}`, {
        headers,
        maxRedirects: 0,
      });
      expect(direct.status()).toBe(404);
      expect(await direct.text()).not.toContain('"stepCode":"regulations"');
    }
    expect(await progress(page.request)).toEqual(before);
    await page.goto("/profile");
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await loginAsTestStudent(page, foreign.credentials);
    const after = await progress(page.request);
    expect(
      after?.steps.find((step) => step.code === "regulations")?.completed,
    ).toBe(true);
    expect(
      after?.steps.find((step) => step.code === "schedule")?.completed,
    ).toBe(false);
  } finally {
    await foreign.close();
  }
});

test("действия принимают браузерный Origin, отклоняют отсутствующий и чужой без записи", async ({
  page,
  loginAs,
  baseURL,
}) => {
  await loginAs("timur");
  const before = await progress(page.request);
  for (const origin of [undefined, "null", "https://foreign.example"]) {
    for (const data of [{ stepCode: "schedule" }, { action: "hide" }]) {
      const { Origin: _origin, ...headers } = browserHeaders(baseURL);
      const response = await page.request.post("/api/me/onboarding", {
        headers: { ...headers, ...(origin ? { Origin: origin } : {}) },
        data,
      });
      expect(response.status()).toBe(403);
      expect(response.headers()["cache-control"]).toContain("no-store");
      await response.body();
    }
  }
  expect(await progress(page.request)).toEqual(before);
  const allowed = await page.request.post("/api/me/onboarding", {
    headers: browserHeaders(baseURL),
    data: { stepCode: "schedule" },
  });
  expect(allowed.status()).toBe(200);
  expect(
    ((await allowed.json()) as OnboardingDto).steps.find(
      (step) => step.code === "schedule",
    )?.completed,
  ).toBe(true);
});

test("автоматические шаги нельзя завершить вручную, неизвестные поля не принимаются", async ({
  page,
  loginAs,
  baseURL,
}) => {
  await loginAs("timur");
  const before = await progress(page.request);
  for (const input of [
    { stepCode: "calendar" },
    { stepCode: "assistant" },
    { stepCode: "push" },
    { stepCode: "passkey" },
    { stepCode: "hidden" },
    { stepCode: "schedule", completed: true },
    { action: "hide", stepCode: "schedule" },
  ]) {
    const response = await page.request.post("/api/me/onboarding", {
      headers: browserHeaders(baseURL),
      data: input,
    });
    expect(response.status()).toBe(400);
    await response.body();
  }
  expect(await progress(page.request)).toEqual(before);
});

test("сотрудник получает 403 при чтении, ручной отметке и скрытии", async ({
  page,
  baseURL,
}) => {
  test.skip(!process.env.DATABASE_URL, "Нужна БД лейна.");
  const staff = await openStaffFixture();
  try {
    await loginAsTestStaff(page, staff.limitedCredentials);
    const headers = browserHeaders(baseURL);
    const read = await page.request.get("/api/me/onboarding", {
      headers,
      maxRedirects: 0,
    });
    const readBody = await read.text();
    expect(read.status()).toBe(403);
    expect(read.headers()["cache-control"]).toContain("no-store");
    expect(readBody).not.toContain('"steps"');
    for (const data of [{ stepCode: "schedule" }, { action: "hide" }]) {
      const response = await page.request.post("/api/me/onboarding", {
        headers,
        data,
        maxRedirects: 0,
      });
      const body = await response.text();
      expect(response.status()).toBe(403);
      expect(response.headers()["cache-control"]).toContain("no-store");
      expect(body).not.toContain('"steps"');
    }
  } finally {
    await staff.close();
  }
});

test("преподаватель получает 403 при чтении, ручной отметке и скрытии", async ({
  page,
  baseURL,
}) => {
  test.skip(!process.env.DATABASE_URL, "Нужна БД лейна.");
  const teacher = await openTeacherTestData();
  try {
    await loginAsTestTeacher(page, teacher.credentials);
    const headers = browserHeaders(baseURL);
    const read = await page.request.get("/api/me/onboarding", {
      headers,
      maxRedirects: 0,
    });
    const readBody = await read.text();
    expect(read.status()).toBe(403);
    expect(read.headers()["cache-control"]).toContain("no-store");
    expect(readBody).not.toContain('"steps"');
    for (const data of [{ stepCode: "schedule" }, { action: "hide" }]) {
      const response = await page.request.post("/api/me/onboarding", {
        headers,
        data,
        maxRedirects: 0,
      });
      const body = await response.text();
      expect(response.status()).toBe(403);
      expect(response.headers()["cache-control"]).toContain("no-store");
      expect(body).not.toContain('"steps"');
    }
  } finally {
    await teacher.close();
  }
});
