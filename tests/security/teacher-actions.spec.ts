import { expect, test } from "./student-login";
import { loginAsTestTeacher, openTeacherTestData } from "./teacher-login";

test("преподаватель не может повторить студенческий Server Action подписки ICS", async ({
  page,
  loginAs,
}) => {
  const teacher = await openTeacherTestData();
  try {
    await loginAs("anna");
    await page.goto("/schedule");
    const requestPromise = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        Boolean(request.headers()["next-action"]),
    );
    await page
      .getByRole("button", { name: "Получить новую ссылку", exact: true })
      .click();
    const captured = await requestPromise;
    await expect(
      page.getByLabel("Ссылка для подписки", { exact: true }),
    ).toBeVisible();
    await loginAsTestTeacher(page, teacher.credentials);
    const headers = captured.headers();
    const response = await page.request.post("/schedule", {
      maxRedirects: 0,
      headers: {
        "Next-Action": headers["next-action"] ?? "",
        "Content-Type": headers["content-type"] ?? "",
        Origin: new URL(page.url()).origin,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
      },
      data: captured.postDataBuffer() ?? Buffer.alloc(0),
    });
    const body = await response.text();
    expect(response.headers()["x-action-redirect"] ?? body).toContain(
      "/teacher",
    );
    expect(body).not.toContain('"path":"/api/calendar/');
    const count =
      await teacher.sql`select id from calendar_tokens where student_id in (select id from students where user_id = ${teacher.actor.userId})`;
    expect(count).toHaveLength(0);
  } finally {
    await teacher.close();
  }
});
