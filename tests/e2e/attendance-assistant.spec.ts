import { expect, test } from "@playwright/test";
import { openAttendanceTestData } from "../integration/attendance-data";
import { loginAsTestStudent } from "../security/student-login";
import { loginAsTestTeacher } from "../security/teacher-login";

test("ассистент на странице QR загружает профиль и разрешает подтверждение полного черновика", async ({
  page,
  browser,
  baseURL,
}) => {
  test.skip(!process.env.DATABASE_URL, "Нужна БД тестового лейна.");
  test.skip(
    process.env.ASSISTANT_RUNTIME !== "mock",
    "Запустите сервер и e2e с ASSISTANT_RUNTIME=mock.",
  );
  if (!baseURL) throw new Error("Нужен адрес приложения.");
  const fixture = await openAttendanceTestData();
  const teacherContext = await browser.newContext({
    baseURL,
    serviceWorkers: "block",
  });
  const profileRequested = Promise.withResolvers<void>();
  const profileDelivered = Promise.withResolvers<void>();
  try {
    const teacher = await teacherContext.newPage();
    await loginAsTestTeacher(teacher, fixture.teacher.credentials);
    await loginAsTestStudent(page, fixture.student.credentials);
    const response = await teacher.request.post(`${fixture.path}/live`, {
      headers: {
        Origin: new URL(baseURL).origin,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
      },
      data: { action: "issue" },
    });
    expect(response.status()).toBe(200);
    const issued = (await response.json()) as { path: string };
    expect(issued.path).toMatch(/^\/attend\/[A-Za-z0-9_-]{22}$/);
    await page.goto(issued.path);
    await expect(page).toHaveURL(/\/attend\/[A-Za-z0-9_-]{22}$/);
    await expect(
      page.getByRole("heading", { name: /^Отметиться на паре «/ }),
    ).toBeVisible();
    const attendanceUrl = page.url();
    await page.route(
      (url) => url.pathname === issued.path,
      async (route) => {
        const request = route.request();
        if (request.method() !== "POST" || !request.headers()["next-action"])
          return route.continue();
        const profileResponse = await route.fetch();
        profileRequested.resolve();
        await profileDelivered.promise;
        await route.fulfill({ response: profileResponse });
      },
    );
    await page
      .getByRole("button", { name: "Спросить или сделать", exact: true })
      .click();
    const sheet = page.getByRole("dialog", {
      name: "Спросить или сделать",
      exact: true,
    });
    await sheet
      .getByRole("button", {
        name: "Нужна справка для работодателя",
        exact: true,
      })
      .click();
    const draft = sheet.getByRole("region", { name: "Черновик заявки" });
    await expect(draft).toContainText("Справка об обучении");
    await expect(draft).toContainText("работодателя");
    await expect(draft).toContainText("Черновик · не отправлен");
    await expect(draft).toContainText(
      "Без вашего нажатия заявка не уйдёт. Проверьте все поля.",
    );
    const confirm = draft.getByRole("button", {
      name: "Подтвердить отправку",
      exact: true,
    });
    const profile = draft.getByRole("region", { name: "Данные из профиля" });
    await expect(profile.getByRole("status")).toHaveText(
      "Загружаем данные профиля…",
    );
    await expect(confirm).toBeDisabled();
    await profileRequested.promise;
    profileDelivered.resolve();
    await expect(profile).toContainText("Студент отметки");
    await expect(profile).toContainText(
      "Из профиля · подставлено автоматически, модель не меняет эти данные",
    );
    await expect(
      profile.getByRole("button", { name: "Повторить загрузку профиля" }),
    ).toHaveCount(0);
    await expect(confirm).toBeEnabled();
    await expect(page).toHaveURL(attendanceUrl);
    const edit = draft.getByRole("link", { name: "Изменить", exact: true });
    await expect(edit).toHaveAttribute("href", /^\/requests\/[0-9a-f-]{36}$/);
    const draftId = (await edit.getAttribute("href"))?.split("/").at(-1);
    if (!draftId) throw new Error("Черновик заявки не создан.");
    const rows = await fixture.teacher.sql<
      { studentId: string; status: string }[]
    >`select student_id as "studentId", status from requests where id = ${draftId}`;
    expect(rows).toEqual([
      { studentId: fixture.student.actor.studentId, status: "draft" },
    ]);
    expect(
      await fixture.teacher
        .sql`select id from attendance_records where student_id = ${fixture.student.actor.studentId}`,
    ).toHaveLength(0);
  } finally {
    profileDelivered.resolve();
    await page.unrouteAll({ behavior: "wait" });
    await teacherContext.close();
    await fixture.close();
  }
});
