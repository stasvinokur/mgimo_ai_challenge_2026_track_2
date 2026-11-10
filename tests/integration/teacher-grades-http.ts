import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { Actor } from "@/application/ports/actor";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { PostgresSessionStore } from "@/infrastructure/db/repositories/identity/sessions";
import { openStaffFixture } from "./staff-fixtures";
import { openTeacherGradesTestData } from "./teacher-grades-data";

export async function checkTeacherGradesHttp(baseURL: string) {
  const f = await openTeacherGradesTestData();
  const foreign = await openTeacherGradesTestData();
  const staff = await openStaffFixture();
  let checks = 0;
  const check = (value: unknown, label: string) => {
    assert(value, label);
    checks++;
  };
  const origin = new URL(baseURL).origin;
  const tokens = new CryptoSessionTokens();
  const sessions = new PostgresSessionStore(() => f.teacher.sql);
  const manifest = JSON.parse(
    await readFile(".next/server/server-reference-manifest.json", "utf8"),
  ) as { node: Record<string, { exportedName: string; filename: string }> };
  const actionId = Object.entries(manifest.node).find(
    ([, entry]) =>
      entry.filename === "src/app/(teacher)/teacher/grades/actions.ts" &&
      entry.exportedName === "setGrade",
  )?.[0];
  const { encodeReply } = createRequire(import.meta.url)(
    "next/dist/compiled/react-server-dom-turbopack/client.node",
  ) as { encodeReply(value: unknown): Promise<string | FormData> };
  async function cookie(actor: Actor) {
    const token = tokens.generate();
    const now = new Date().toISOString();
    await sessions.create({
      id: f.teacher.ids.next(),
      userId: actor.userId,
      tokenHash: tokens.hash(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    return `__Host-pulse-session=${token}`;
  }
  try {
    assert(actionId, "Server Action ведомости есть в production manifest");
    const actionHeaders = {
      "Next-Action": actionId,
      Accept: "text/x-component",
    };
    const teacherCookie = await cookie(f.teacher.actor);
    const studentCookie = await cookie(f.student.actor);
    const otherCookie = await cookie(f.otherStudent.actor);
    const staffCookie = await cookie(staff.limited);
    async function request(
      path: string,
      session: string,
      init: RequestInit = {},
    ) {
      const response = await fetch(new URL(path, baseURL), {
        ...init,
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
        headers: {
          Cookie: session,
          Origin: origin,
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Dest": "document",
          ...init.headers,
        },
      });
      return { response, body: await response.text() };
    }
    async function flight(path: string, session: string) {
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
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
      };
      let result = await request(path, session, { headers });
      if (result.response.status === 307) {
        const target = new URL(
          result.response.headers.get("location") ?? "",
          baseURL,
        );
        if (target.pathname === path && target.searchParams.has("_rsc")) {
          check(
            target.origin === origin,
            "RSC cache-key остаётся на своём origin",
          );
          result = await request(
            `${target.pathname}${target.search}`,
            session,
            { headers },
          );
        }
      }
      return result;
    }
    const list = await request("/teacher/grades", teacherCookie);
    check(
      list.response.status === 200 && list.body.includes(f.courseTitle),
      "В списке есть курс своей пары",
    );
    check(
      !list.body.includes(foreign.courseTitle),
      "В списке нет чужого курса",
    );
    const own = await request(f.path, teacherCookie);
    check(
      own.response.status === 200 && own.body.includes("Студент ведомости"),
      "Своя ведомость открывается",
    );
    check(
      own.body.includes('class="teacher-gradebook-input"') &&
        own.body.includes('name="expectedScore"') &&
        own.body.includes("<select"),
      "Форма использует явный CSS-класс, было и закрытый список причин",
    );
    let styles = "";
    const stylePaths = [
      ...own.body.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g),
    ]
      .map((match) => match[1])
      .filter((path): path is string => Boolean(path));
    for (const path of new Set(stylePaths))
      styles += (await request(path, teacherCookie)).body;
    const inputStyle =
      styles.match(/\.teacher-gradebook-input\s*\{([^}]+)\}/)?.[1] ?? "";
    check(
      /min-height:\s*44px/.test(inputStyle) &&
        /(?:^|;)height:\s*44px/.test(inputStyle),
      "Production CSS содержит поле с высотой и минимумом 44 px",
    );
    const ownData = await request(`${f.path}/data`, teacherCookie);
    check(
      ownData.response.status === 200 && ownData.body.includes(f.entryKey),
      "API возвращает ключ своей ячейки",
    );
    for (const [label, session] of [
      ["студент", studentCookie],
      ["сотрудник", staffCookie],
    ] as const) {
      for (const path of ["/teacher/grades", f.path]) {
        const html = await request(path, session);
        check(html.response.status === 403, `${label}: HTML ведомости 403`);
        check(
          !html.body.includes(f.courseTitle) && !html.body.includes(f.entryKey),
          `${label}: HTML без данных ведомости`,
        );
        const rsc = await flight(path, session);
        check(
          rsc.response.status === 403 ||
            rsc.body.includes("NEXT_HTTP_ERROR_FALLBACK;403"),
          `${label}: RSC запрещён`,
        );
        check(
          !rsc.body.includes(f.courseTitle) && !rsc.body.includes(f.entryKey),
          `${label}: RSC без данных ведомости`,
        );
      }
      const data = await request(`${f.path}/data`, session);
      check(data.response.status === 403, `${label}: API ведомости 403`);
    }
    for (const suffix of ["", "/data"]) {
      const denied = await request(`${foreign.path}${suffix}`, teacherCookie);
      check(
        denied.response.status === 404 &&
          !denied.body.includes(foreign.courseTitle),
        "Чужая ведомость и API — 404",
      );
    }
    const foreignRsc = await flight(foreign.path, teacherCookie);
    check(
      foreignRsc.body.includes("NEXT_HTTP_ERROR_FALLBACK;404") &&
        !foreignRsc.body.includes(foreign.courseTitle),
      "Чужая ведомость скрыта в RSC",
    );
    const anonymous = await request(f.path, "");
    check(
      anonymous.response.status === 307 &&
        (anonymous.response.headers.get("location") ?? "").includes("/login"),
      "Аноним направлен на вход",
    );
    console.info({ stage: "Роли, HTML/RSC и владельцы", checks });
    async function snapshot() {
      return f.teacher.sql`
        select
          (select score from scores where student_id = ${f.student.actor.studentId} and assessment_id = ${f.workId}) as score,
          (select count(*)::int from score_events where student_id = ${f.student.actor.studentId} and assessment_id = ${f.workId}) as events,
          (select count(*)::int from notifications where user_id = ${f.student.actor.userId} and link = ${`/grades/${f.courseId}`}) as notifications`;
    }
    async function submit(
      value: string,
      reason: string,
      options: {
        entryKey?: string;
        session?: string;
        requestOrigin?: string | null;
        expectedScore?: number | null;
        lesson?: typeof f.key;
      } = {},
    ) {
      const data = new FormData();
      data.set("score", value);
      data.set("reason", reason);
      data.set("entryKey", options.entryKey ?? f.entryKey);
      const [current] = await snapshot();
      const expected =
        options.expectedScore === undefined
          ? (current?.score ?? null)
          : options.expectedScore;
      data.set("expectedScore", expected === null ? "" : String(expected));
      const response = await fetch(new URL(f.path, baseURL), {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
        headers: {
          Cookie: options.session ?? teacherCookie,
          ...actionHeaders,
          ...(options.requestOrigin === null
            ? {}
            : { Origin: options.requestOrigin ?? origin }),
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Dest": "empty",
        },
        body: await encodeReply([
          options.lesson ?? f.key,
          { status: "idle", message: "" },
          data,
        ]),
      });
      return { response, body: await response.text() };
    }
    const first = await submit("80", "");
    check(
      first.response.status === 200 && first.body.includes("Балл сохранён"),
      "Server Action выставляет первый балл",
    );
    const saved = await snapshot();
    check(
      saved[0]?.score === 80 &&
        saved[0]?.events === 1 &&
        saved[0]?.notifications === 1,
      "Балл, событие и уведомление записаны",
    );
    console.info({ stage: "Первый балл и транзакция", checks });
    await submit("80", "");
    check(
      JSON.stringify(await snapshot()) === JSON.stringify(saved),
      "Повтор не создаёт события и уведомления",
    );
    const stale = await submit("90", "retake", { expectedScore: null });
    check(
      stale.body.includes("Балл уже изменили, обновите ведомость") &&
        JSON.stringify(await snapshot()) === JSON.stringify(saved),
      "Устаревшее было не перезаписывает новый балл",
    );
    for (const [value, reason] of [
      ["90", ""],
      ["-1", "Ошибка"],
      ["101", "Ошибка"],
      ["1.5", "Ошибка"],
      ["90", "я".repeat(301)],
      ["90", "Свободная причина"],
    ] as const) {
      await submit(value, reason);
      check(
        JSON.stringify(await snapshot()) === JSON.stringify(saved),
        "Невалидная правка не меняет балл и историю",
      );
    }
    for (const options of [
      { entryKey: foreign.entryKey },
      { lesson: foreign.key },
      { session: studentCookie },
      { session: staffCookie },
      { requestOrigin: null },
      { requestOrigin: "https://foreign.example" },
    ]) {
      const denied = await submit("90", "retake", options);
      if ("session" in options)
        check(
          denied.response.status === 403,
          "Server Action чужой ролью возвращает HTTP 403",
        );
      if ("lesson" in options || "entryKey" in options)
        check(
          denied.response.status === 404,
          "Чужой bound slot скрыт до записи",
        );
      check(
        JSON.stringify(await snapshot()) === JSON.stringify(saved),
        "Чужая ячейка, роль и Origin не меняют данные",
      );
    }
    await submit("90", "retake");
    const corrected = await snapshot();
    check(
      corrected[0]?.score === 90 &&
        corrected[0]?.events === 2 &&
        corrected[0]?.notifications === 2,
      "Исправление сохраняет новый балл и второй факт",
    );
    console.info({ stage: "Повторы, валидация, Origin и исправление", checks });
    const history = await request(
      `/grades/${f.courseId}/history`,
      studentCookie,
    );
    check(
      history.response.status === 200 &&
        history.body.includes('"newScore":90') &&
        history.body.includes("Пересдача") &&
        !history.body.includes('"reason":"retake"'),
      "Студент читает свою историю через API",
    );
    const detail = await request(`/grades/${f.courseId}`, studentCookie);
    check(
      detail.response.status === 200 &&
        detail.body.includes("История изменений") &&
        detail.body.replaceAll("<!-- -->", "").includes("80 → 90") &&
        detail.body.includes("МСК"),
      "HTML показывает историю и московское время",
    );
    const gradeData = await request(
      `/grades/${f.courseId}/data`,
      studentCookie,
    );
    check(
      gradeData.response.status === 200 &&
        gradeData.body.includes('"secured":89'),
      "Существующий расчёт пересчитал итог до 89",
    );
    const grades = await request("/grades", studentCookie);
    check(
      grades.body.includes("Повышенная стипендия сохраняется"),
      "Прогноз стипендии пересчитан",
    );
    const notifications = await request("/notifications", studentCookie);
    check(
      notifications.body.includes(
        `Новая оценка: ${f.courseTitle} — ${f.workTitle}`,
      ) && notifications.body.includes(`/grades/${f.courseId}`),
      "Уведомление ведёт в карточку дисциплины",
    );
    const otherHistory = await request(
      `/grades/${f.courseId}/history?studentId=${f.student.actor.studentId}`,
      otherCookie,
    );
    check(
      otherHistory.response.status === 200 &&
        !otherHistory.body.includes('"newScore":90') &&
        !otherHistory.body.includes("Пересдача"),
      "Студент той же группы не видит чужой истории даже с query studentId",
    );
    for (const suffix of ["", "/data", "/history"]) {
      const denied = await request(
        `/grades/${foreign.courseId}${suffix}`,
        studentCookie,
      );
      check(
        denied.response.status === 404 &&
          !denied.body.includes(foreign.courseTitle),
        "Чужая дисциплина, баллы и история — 404",
      );
    }
    const studentFlight = await flight(
      `/grades/${foreign.courseId}`,
      studentCookie,
    );
    check(
      studentFlight.body.includes("NEXT_HTTP_ERROR_FALLBACK;404") &&
        !studentFlight.body.includes(foreign.courseTitle),
      "История чужой дисциплины скрыта в RSC студента",
    );
    return { checks };
  } finally {
    await staff.close();
    await foreign.close();
    await f.close();
  }
}

if (import.meta.main) {
  try {
    console.info(
      await checkTeacherGradesHttp(
        `http://127.0.0.1:${process.env.PORT || "3000"}`,
      ),
    );
  } catch (error) {
    console.error(
      error instanceof assert.AssertionError
        ? error.message
        : "HTTP-проверка ведомости не завершена.",
    );
    process.exitCode = 1;
  }
}
