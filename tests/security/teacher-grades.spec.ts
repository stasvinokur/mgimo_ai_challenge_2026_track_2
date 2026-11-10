import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { expect, type Page, test } from "@playwright/test";
import { openStaffFixture } from "../integration/staff-fixtures";
import { openTeacherGradesTestData } from "../integration/teacher-grades-data";
import { loginAsTestStaff } from "./staff-login";
import { loginAsTestStudent } from "./student-login";
import { loginAsTestTeacher } from "./teacher-login";

async function exportedSetGradeRequest(
  page: Page,
  baseURL: string,
  expectedActionId: string,
  path: string,
  lesson: { slotId: string; occurrenceDate: string },
  fields: Record<string, string>,
) {
  const manifest = JSON.parse(
    await readFile(".next/server/server-reference-manifest.json", "utf8"),
  ) as { node: Record<string, { exportedName: string; filename: string }> };
  const actionId = Object.entries(manifest.node).find(
    ([, entry]) =>
      entry.filename === "src/app/(teacher)/teacher/grades/actions.ts" &&
      entry.exportedName === "setGrade",
  )?.[0];
  expect(Boolean(actionId) && actionId === expectedActionId).toBe(true);
  const { encodeReply } = createRequire(import.meta.url)(
    "next/dist/compiled/react-server-dom-turbopack/client.node",
  ) as { encodeReply(value: unknown): Promise<string | FormData> };
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  const payload = await encodeReply([
    lesson,
    { status: "idle", message: "" },
    form,
  ]);
  const url = new URL(path, baseURL);
  const cookie = (await page.context().cookies(url.href))
    .map((item) => `${item.name}=${item.value}`)
    .join("; ");
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Cookie: cookie,
        Origin: url.origin,
        "Next-Action": actionId ?? "",
        Accept: "text/x-component",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        ...(typeof payload === "string"
          ? { "Content-Type": "text/plain;charset=UTF-8" }
          : {}),
      },
      body: payload,
    });
    return { status: response.status, body: await response.text() };
  } catch {
    throw new Error(
      "Не удалось выполнить HTTP-проверку Server Action ведомости.",
    );
  }
}

async function flight(page: Page, path: string) {
  const segments = path.split("/").filter(Boolean);
  let branch: unknown[] = ["__PAGE__", {}, null, "refetch"];
  for (const [index, segment] of [...segments.entries()].reverse()) {
    const key = path.startsWith("/teacher/")
      ? index === 2
        ? ["slotId", segment, "d", null]
        : index === 3
          ? ["date", segment, "d", null]
          : segment
      : index === 1
        ? ["courseId", segment, "d", null]
        : segment;
    branch = [key, { children: branch }];
  }
  const headers = {
    RSC: "1",
    "Next-Router-State-Tree": encodeURIComponent(
      JSON.stringify([
        "",
        {
          children: [
            path.startsWith("/teacher/") ? "(teacher)" : "(student)",
            { children: branch },
          ],
        },
      ]),
    ),
  };
  let response = await page.request.get(path, { headers, maxRedirects: 0 });
  if (response.status() === 307) {
    const target = new URL(response.headers().location ?? "", response.url());
    if (target.pathname === path && target.searchParams.has("_rsc")) {
      expect(target.origin).toBe(new URL(response.url()).origin);
      response = await page.request.get(target.toString(), {
        headers,
        maxRedirects: 0,
      });
    }
  }
  return { response, body: await response.text() };
}

test("ведомость: студент и сотрудник получают 403 в HTML, API и поддельном RSC", async ({
  page,
}) => {
  test.skip(!process.env.DATABASE_URL, "Нужна БД тестового лейна.");
  const f = await openTeacherGradesTestData();
  const staff = await openStaffFixture();
  try {
    for (const role of ["student", "staff"] as const) {
      if (role === "student")
        await loginAsTestStudent(page, f.student.credentials);
      else await loginAsTestStaff(page, staff.limitedCredentials);
      for (const path of ["/teacher/grades", f.path]) {
        const html = await page.request.get(path, { maxRedirects: 0 });
        expect(html.status()).toBe(403);
        expect(await html.text()).not.toContain(f.courseTitle);
        const rsc = await flight(page, path);
        expect(
          rsc.response.status() === 403 ||
            rsc.body.includes("NEXT_HTTP_ERROR_FALLBACK;403"),
        ).toBe(true);
        expect(rsc.body).not.toContain(f.courseTitle);
        expect(rsc.body).not.toContain("Студент ведомости");
        expect(rsc.body).not.toContain(f.entryKey);
      }
      const data = await page.request.get(`${f.path}/data`);
      expect(data.status()).toBe(403);
      expect(await data.text()).not.toContain(f.entryKey);
    }
  } finally {
    await staff.close();
    await f.close();
  }
});

test("чужой курс, группа и ячейка скрыты; Origin и повтор действия сохраняют изоляцию", async ({
  page,
  baseURL,
}) => {
  test.skip(!process.env.DATABASE_URL, "Нужна БД тестового лейна.");
  const f = await openTeacherGradesTestData();
  const foreign = await openTeacherGradesTestData();
  const staff = await openStaffFixture();
  try {
    if (!baseURL) throw new Error("Укажите адрес production-приложения.");
    await loginAsTestTeacher(page, f.teacher.credentials);
    for (const path of [foreign.path, `${foreign.path}/data`]) {
      const response = await page.request.get(path);
      expect(response.status()).toBe(404);
      const body = await response.text();
      expect(body).not.toContain(foreign.courseTitle);
      expect(body).not.toContain(foreign.entryKey);
    }
    const deniedFlight = await flight(page, foreign.path);
    expect(deniedFlight.body).toContain("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(deniedFlight.body).not.toContain(foreign.courseTitle);
    await page.goto(f.path);
    const form = page.getByRole("form", {
      name: `Студент ведомости — ${f.workTitle}`,
      exact: true,
    });
    await expect(form).toHaveAttribute("data-hydrated", "true");
    await form
      .getByRole("spinbutton", { name: "Балл", exact: true })
      .fill("80");
    const requestPromise = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        Boolean(request.headers()["next-action"]),
    );
    await form
      .getByRole("button", { name: "Сохранить балл", exact: true })
      .click();
    const captured = await requestPromise;
    await expect(form.getByRole("status")).toContainText("Балл сохранён");
    const headers = captured.headers();
    const body = captured.postDataBuffer()?.toString("utf8");
    if (!body?.includes(f.entryKey))
      throw new Error("Действие не содержит ключа ячейки.");
    const snapshot = () => f.teacher.sql`
      select sc.score,
        (select count(*)::int from score_events where assessment_id = ${f.workId}) as events,
        (select count(*)::int from notifications where user_id = ${f.student.actor.userId} and link = ${`/grades/${f.courseId}`}) as notifications
      from scores sc where sc.assessment_id = ${f.workId} and sc.student_id = ${f.student.actor.studentId}`;
    const before = await snapshot();
    async function replay(data: string, origin: string | undefined) {
      return page.request.post(f.path, {
        maxRedirects: 0,
        headers: {
          "Next-Action": headers["next-action"] ?? "",
          "Content-Type": headers["content-type"] ?? "",
          Accept: "text/x-component",
          ...(origin ? { Origin: origin } : {}),
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Dest": "empty",
        },
        data,
      });
    }
    const origin = new URL(page.url()).origin;
    const repeated = await replay(body, origin);
    expect(await repeated.text()).toContain(
      "Балл уже изменили, обновите ведомость",
    );
    expect(await snapshot()).toEqual(before);
    await expect(form.locator('input[name="expectedScore"]')).toHaveValue("80");
    const noOpRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        Boolean(request.headers()["next-action"]),
    );
    await form
      .getByRole("button", { name: "Сохранить балл", exact: true })
      .click();
    const fresh = await noOpRequest;
    await expect(form.getByRole("status")).toContainText("Балл не изменился");
    const freshBody = fresh.postDataBuffer()?.toString("utf8");
    if (!freshBody?.includes(f.entryKey))
      throw new Error("Повторное действие не содержит ключа ячейки.");
    headers["content-type"] = fresh.headers()["content-type"] ?? "";
    const current = await replay(freshBody, origin);
    expect(await current.text()).toContain("Балл не изменился");
    expect(await snapshot()).toEqual(before);
    const denied = await replay(
      freshBody.replaceAll(f.entryKey, foreign.entryKey),
      origin,
    );
    expect(denied.status()).toBe(404);
    expect(await denied.text()).toMatch(
      /NEXT_HTTP_ERROR_FALLBACK;404|Объект не найден/,
    );
    expect(await snapshot()).toEqual(before);
    const foreignBefore = await foreign.teacher.sql`
      select
        (select score from scores where assessment_id = ${foreign.workId} and student_id = ${foreign.student.actor.studentId}) as score,
        (select count(*)::int from score_events where assessment_id = ${foreign.workId}) as events,
        (select count(*)::int from notifications where user_id = ${foreign.student.actor.userId} and link = ${`/grades/${foreign.courseId}`}) as notifications`;
    const foreignLesson = await exportedSetGradeRequest(
      page,
      baseURL,
      headers["next-action"] ?? "",
      f.path,
      foreign.key,
      {
        entryKey: foreign.entryKey,
        expectedScore: "",
        score: "90",
        reason: "retake",
      },
    );
    expect(foreignLesson.status).toBe(404);
    expect(foreignLesson.body).not.toContain("Балл сохранён");
    expect(await snapshot()).toEqual(before);
    expect(
      await foreign.teacher.sql`
      select
        (select score from scores where assessment_id = ${foreign.workId} and student_id = ${foreign.student.actor.studentId}) as score,
        (select count(*)::int from score_events where assessment_id = ${foreign.workId}) as events,
        (select count(*)::int from notifications where user_id = ${foreign.student.actor.userId} and link = ${`/grades/${foreign.courseId}`}) as notifications`,
    ).toEqual(foreignBefore);
    for (const providedOrigin of [undefined, "https://foreign.example"]) {
      const blocked = await replay(freshBody, providedOrigin);
      const payload = await blocked.text();
      expect(
        blocked.status() >= 400 ||
          payload.includes("Недостаточно прав для этого действия"),
      ).toBe(true);
      expect(await snapshot()).toEqual(before);
    }
    await loginAsTestStudent(page, f.student.credentials);
    const studentReplay = await replay(freshBody, origin);
    expect(studentReplay.status()).toBe(403);
    expect(await studentReplay.text()).not.toContain("Балл сохранён");
    expect(await snapshot()).toEqual(before);
    for (const suffix of ["", "/data", "/history"]) {
      const response = await page.request.get(
        `/grades/${foreign.courseId}${suffix}`,
      );
      expect(response.status()).toBe(404);
      expect(await response.text()).not.toContain(foreign.courseTitle);
    }
    const studentFlight = await flight(page, `/grades/${foreign.courseId}`);
    expect(studentFlight.body).toContain("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(studentFlight.body).not.toContain(foreign.courseTitle);
    await loginAsTestStaff(page, staff.limitedCredentials);
    const staffReplay = await replay(freshBody, origin);
    expect(staffReplay.status()).toBe(403);
    expect(await staffReplay.text()).not.toContain("Балл сохранён");
    expect(await snapshot()).toEqual(before);
    await loginAsTestStudent(page, f.otherStudent.credentials);
    await page.goto(
      `/grades/${f.courseId}?studentId=${f.student.actor.studentId}`,
    );
    const history = page.getByRole("region", {
      name: "История изменений",
      exact: true,
    });
    await expect(history).not.toContainText("Не выставлен → 80");
    const ownHistory = await page.request.get(
      `/grades/${f.courseId}/history?studentId=${f.student.actor.studentId}`,
    );
    expect(ownHistory.status()).toBe(200);
    expect(await ownHistory.text()).not.toContain('"newScore":80');
  } finally {
    await staff.close();
    await foreign.close();
    await f.close();
  }
});
