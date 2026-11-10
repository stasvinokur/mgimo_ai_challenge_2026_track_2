import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { addDays } from "@/domain/schedule/dates";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { PostgresSessionStore } from "@/infrastructure/db/repositories/identity/sessions";
import { openAttendanceTestData } from "./attendance-data";
import { openStudentTestData } from "./student-e2e-data";
import { openTeacherTestData } from "./teacher-e2e-data";

export async function checkAttendanceHttp(baseURL: string) {
  const f = await openAttendanceTestData(),
    outsider = await openStudentTestData("timur"),
    otherTeacher = await openTeacherTestData();
  const tokens = new CryptoSessionTokens(),
    sessions = new PostgresSessionStore(() => f.teacher.sql);
  const ids: string[] = [];
  const origin = new URL(baseURL).origin;
  let checks = 0;
  const check = (condition: unknown, message: string) => {
    assert(condition, message);
    checks++;
  };
  async function cookie(userId: string) {
    const token = tokens.generate(),
      id = f.teacher.ids.next(),
      now = new Date().toISOString();
    ids.push(id);
    await sessions.create({
      id,
      userId,
      tokenHash: tokens.hash(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    return `__Host-pulse-session=${token}`;
  }
  const jar = {
    teacher: await cookie(f.teacher.actor.userId),
    student: await cookie(f.student.actor.userId),
    unmarked: await cookie(f.unmarked.actor.userId),
    outsider: await cookie(outsider.actor.userId),
    otherTeacher: await cookie(otherTeacher.actor.userId),
  };
  async function request(
    path: string,
    auth = "",
    init: RequestInit = {},
    withOrigin = true,
  ) {
    try {
      return await fetch(new URL(path, baseURL), {
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
        ...init,
        headers: {
          Cookie: auth,
          ...(withOrigin ? { Origin: origin } : {}),
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Dest": "empty",
          ...init.headers,
        },
      });
    } catch {
      throw new Error("HTTP_ATTENDANCE_REQUEST_FAILED");
    }
  }
  async function post(
    action: unknown,
    auth = jar.teacher,
    withOrigin = true,
    ip?: string,
  ) {
    return request(
      `${f.path}/live`,
      auth,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(ip ? { "X-Forwarded-For": ip } : {}),
        },
        body: JSON.stringify(action),
      },
      withOrigin,
    );
  }
  async function records() {
    return f.teacher
      .sql`select id, student_id, status from attendance_records where slot_id = ${f.key.slotId} order by student_id`;
  }
  try {
    const missingOrigin = await post({ action: "issue" }, jar.teacher, false);
    check(missingOrigin.status === 403, "Выдача без Origin отклонена");
    await missingOrigin.text();
    const foreign = await post({ action: "issue" }, jar.otherTeacher);
    check(foreign.status === 404, "Чужой преподаватель не выдаёт QR");
    await foreign.text();
    const beforeDeniedClose = await records();
    const foreignClose = await post({ action: "close" }, jar.otherTeacher);
    check(foreignClose.status === 404, "Закрытие чужой пары даёт 404");
    await foreignClose.text();
    const studentPost = await post({ action: "close" }, jar.student);
    check(studentPost.status === 403, "Студент получает 403 от POST live");
    await studentPost.text();
    check(
      JSON.stringify(await records()) === JSON.stringify(beforeDeniedClose),
      "Отказ чужой роли и владельцу не оставляет записей",
    );
    const conflicts: string[] = [];
    for (const offset of [-7, 7]) {
      const occurrence = addDays(f.key.occurrenceDate, offset);
      const rejected = await request(
        `/teacher/attendance/${f.key.slotId}/${occurrence}/live`,
        jar.teacher,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "close" }),
        },
      );
      conflicts.push(await rejected.text());
      check(
        rejected.status === 409,
        "Закрытие прошлого/будущего occurrence запрещено",
      );
    }
    check(conflicts[0] === conflicts[1], "Вне окна закрытия единый отказ");
    check(
      JSON.stringify(await records()) === JSON.stringify(beforeDeniedClose),
      "Прошлая и будущая даты не меняют посещаемость",
    );
    const oversized = await request(`${f.path}/live`, jar.teacher, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({ action: "issue", padding: "я".repeat(600) }),
            ),
          );
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    check(oversized.status === 400, "Chunked тело больше 1024 байт отклонено");
    await oversized.text();
    const malformed = await request(`${f.path}/live`, jar.teacher, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    check(malformed.status === 400, "Неверный JSON даёт 400");
    await malformed.text();
    const injectedIp = await post({ action: "issue", ip: "198.51.100.99" });
    check(injectedIp.status === 400, "IP из body не принимается");
    await injectedIp.text();
    const issued = await post({ action: "issue" });
    check(issued.status === 200, "Выдача QR через production route");
    const qr = (await issued.json()) as {
      path: string;
      url: string;
      qrImage: string;
    };
    check(
      /^\/attend\/[A-Za-z0-9_-]{22}$/.test(qr.path) &&
        qr.qrImage.startsWith("data:image/svg+xml,"),
      "Формат QR",
    );
    const anonymous = await request(qr.path);
    const destination = new URL(
      anonymous.headers.get("location") ?? "",
      baseURL,
    );
    check(
      anonymous.status === 307 &&
        destination.pathname === "/login" &&
        destination.searchParams.get("next") === qr.path,
      "Аноним возвращается через next",
    );
    await anonymous.text();
    const before = await records();
    const confirmation = await request(qr.path, jar.student, {
      headers: {
        Accept: "text/html",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "document",
      },
    });
    const html = await confirmation.text();
    check(
      confirmation.status === 200 && html.includes("Отметиться на паре"),
      "GET подтверждения",
    );
    check(
      JSON.stringify(await records()) === JSON.stringify(before),
      "GET не меняет отметки",
    );
    check(
      confirmation.headers.get("cache-control")?.includes("no-store"),
      "Код не кэшируется",
    );
    for (const path of ["/attend", qr.path]) {
      const english = await request(path, `${jar.student}; pulse-language=en`, {
        headers: {
          Accept: "text/html",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Dest": "document",
        },
      });
      const englishBody = await english.text();
      check(
        english.status === 200 &&
          englishBody.includes('lang="en"') &&
          englishBody.includes("Class check-in") &&
          englishBody.includes(
            path === "/attend"
              ? "open the current QR code"
              : "Confirm that you are in the classroom",
          ),
        "English: серверное подтверждение и инструкция до JavaScript",
      );
    }
    const invalidGroup = await request(qr.path, jar.outsider);
    const outsiderBody = await invalidGroup.text();
    check(
      outsiderBody.includes("Код недействителен или устарел") &&
        !outsiderBody.includes("Отметиться на паре «"),
      "Чужая группа не видит пару",
    );
    const manifest = JSON.parse(
      await readFile(".next/server/server-reference-manifest.json", "utf8"),
    ) as { node: Record<string, { exportedName: string; filename: string }> };
    const actionId = Object.entries(manifest.node).find(
      ([, entry]) =>
        entry.filename === "src/app/attend/actions.ts" &&
        entry.exportedName === "markAttendance",
    )?.[0];
    assert(actionId, "Server Action отсутствует в production manifest");
    const profileActionId = Object.entries(manifest.node).find(
      ([, entry]) =>
        entry.filename === "src/app/(student)/requests/actions.ts" &&
        entry.exportedName === "getRequestProfileAction",
    )?.[0];
    assert(
      profileActionId,
      "Действие профиля отсутствует в production manifest",
    );
    for (const path of ["/attend", qr.path]) {
      const page = await request(path, jar.student, {
        headers: {
          Accept: "text/html",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Dest": "document",
        },
      });
      const pageBody = await page.text();
      check(
        page.status === 200 &&
          pageBody.includes(profileActionId) &&
          (pageBody.match(/class="app-shell"/g)?.length ?? 0) === 1,
        "Оболочка отметки передаёт действие профиля без дублирования",
      );
      const profile = await request(path, jar.student, {
        method: "POST",
        headers: {
          "Next-Action": profileActionId,
          "Content-Type": "application/json",
          Accept: "text/x-component",
        },
        body: "[]",
      });
      const profileBody = await profile.text();
      check(
        profile.status === 200 &&
          profileBody.includes('"ok":true') &&
          profileBody.includes('"fullName":"Студент отметки"') &&
          profileBody.includes('"recordBookNo":'),
        "На странице отметки работает настоящий Server Action своего профиля",
      );
    }
    const { encodeReply } = createRequire(import.meta.url)(
      "next/dist/compiled/react-server-dom-turbopack/client.node",
    ) as { encodeReply(value: unknown): Promise<string | FormData> };
    const actionHeaders = {
      "Next-Action": actionId,
      Accept: "text/x-component",
    };
    const payload = () => encodeReply([qr.path.slice(8), null, new FormData()]);
    const noOrigin = await request(
      qr.path,
      jar.student,
      { method: "POST", headers: actionHeaders, body: await payload() },
      false,
    );
    const noOriginBody = await noOrigin.text();
    check(
      noOrigin.status === 403 ||
        noOriginBody.includes('"messageCode":"forbidden"'),
      "Server Action без Origin отклонён",
    );
    check((await records()).length === before.length, "Без Origin нет записи");
    const foreignMark = await request(qr.path, jar.outsider, {
      method: "POST",
      headers: actionHeaders,
      body: await payload(),
    });
    check(
      (await foreignMark.text()).includes('"messageCode":"invalidCode"'),
      "Чужая группа не подтверждает код через Server Action",
    );
    check(
      (await records()).length === before.length,
      "Чужая группа не оставила записи",
    );
    const mark = await request(qr.path, jar.student, {
      method: "POST",
      headers: actionHeaders,
      body: await payload(),
    });
    const markedBody = await mark.text();
    check(
      mark.status === 200 && markedBody.includes('"messageCode":"marked"'),
      "Server Action подтверждает отметку",
    );
    const repeat = await request(qr.path, jar.student, {
      method: "POST",
      headers: actionHeaders,
      body: await payload(),
    });
    check(
      (await repeat.text()).includes('"messageCode":"alreadyPresent"'),
      "Повтор Server Action",
    );
    const englishSummary = await request(
      "/grades",
      `${jar.student}; pulse-language=en`,
    );
    const englishSummaryBody = await englishSummary.text();
    check(
      englishSummary.status === 200 &&
        englishSummaryBody.includes("Attendance and activity") &&
        englishSummaryBody.includes("Attended 1 of 1") &&
        englishSummaryBody.includes("of 20 — personal goal"),
      "English: серверная сводка посещаемости после отметки",
    );
    check(
      (await records()).filter((row) => row.status === "present").length === 1,
      "Ровно одна отметка",
    );
    const rosterResponse = await request(`${f.path}/live`, jar.teacher);
    const roster = (await rosterResponse.json()) as {
      present: number;
      total: number;
      roster: Record<string, unknown>[];
    };
    check(roster.present === 1 && roster.total === 3, "Живой счётчик");
    check(
      roster.roster.every(
        (row) =>
          Object.keys(row).sort().join() === "fullName,group,reason,status",
      ),
      "Минимальный ростер",
    );
    const teacherPage = await request(f.path, jar.teacher);
    const teacherHtml = await teacherPage.text();
    check(
      /<details\b[^>]*data-testid="attendance-roster"[^>]*>/.test(
        teacherHtml,
      ) && !/<details\b[^>]*\bopen(?:=|\s|>)/.test(teacherHtml),
      "Ростер свёрнут по умолчанию на экране аудитории",
    );
    const grades = await request("/grades", jar.student);
    const gradesBody = await grades.text();
    check(
      grades.status === 200 &&
        gradesBody.includes('id="attendance"') &&
        gradesBody.includes("Баллы не влияют на оценки и стипендию"),
      "Посещаемость в Учёбе",
    );
    const gradesAnchor = gradesBody.includes("Как у меня дела")
      ? gradesBody.indexOf("Как у меня дела")
      : gradesBody.indexOf("Оценок пока нет");
    check(
      gradesAnchor >= 0 && gradesAnchor < gradesBody.indexOf('id="attendance"'),
      "Посещаемость ниже успеваемости или её пустого состояния",
    );
    check(
      !gradesBody.includes("Уважительные причины: <!-- -->0") &&
        !gradesBody.includes("Был на <!-- -->0<!-- --> из <!-- -->0"),
      "Нет повторяющихся нулевых карточек/причин",
    );
    await f.teacher
      .sql`insert into activity_points (id, student_id, source_key, points) values (${f.teacher.ids.next()}, ${outsider.actor.studentId}, 'attendance-http-private', 37)`;
    const forgedSummary = await request(
      `/grades?studentId=${outsider.actor.studentId}`,
      jar.student,
    );
    const forgedBody = await forgedSummary.text();
    const attendanceSection =
      forgedBody.match(/<section id="attendance"[\s\S]*?<\/section>/)?.[0] ??
      "";
    const attendanceText = attendanceSection
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ");
    check(
      forgedSummary.status === 200 &&
        attendanceText.includes("1 из 20") &&
        !attendanceText.includes("37"),
      "Подмена studentId не раскрывает чужие баллы",
    );
    const guessed = await request(
      `/grades/attendance/${outsider.actor.studentId}`,
      jar.student,
    );
    check(guessed.status === 404, "IDOR прямого URL посещаемости отсутствует");
    await guessed.text();
    const guessedApi = await request(
      `/grades/attendance/${outsider.actor.studentId}/data`,
      jar.student,
    );
    check(
      guessedApi.status === 404,
      "IDOR предполагаемого API посещаемости отсутствует",
    );
    await guessedApi.text();
    for (const [auth, expected] of [
      [jar.student, 403],
      [jar.otherTeacher, 404],
    ] as const) {
      const page = await request(f.path, auth);
      const pageBody = await page.text();
      check(
        page.status === expected && !pageBody.includes("Студент отметки"),
        "Владелец HTML пары",
      );
      const headers = {
        RSC: "1",
        "Next-Router-State-Tree": encodeURIComponent(
          JSON.stringify([
            "",
            {
              children: [
                "(teacher)",
                {
                  children: [
                    "teacher",
                    {
                      children: [
                        "attendance",
                        {
                          children: [
                            ["slotId", f.key.slotId, "d", null],
                            {
                              children: [
                                ["date", f.key.occurrenceDate, "d", null],
                                { children: ["__PAGE__", {}, null, "refetch"] },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ]),
        ),
      };
      let flight = await request(f.path, auth, { headers });
      if (flight.status === 307) {
        const location = new URL(flight.headers.get("location") ?? "", baseURL);
        if (location.pathname === f.path && location.searchParams.has("_rsc")) {
          await flight.text();
          flight = await request(
            `${location.pathname}${location.search}`,
            auth,
            { headers },
          );
        }
      }
      const body = await flight.text();
      check(
        (flight.status === expected ||
          body.includes(`NEXT_HTTP_ERROR_FALLBACK;${expected}`)) &&
          !body.includes("Студент отметки"),
        "Владелец RSC пары",
      );
    }
    const closed = await post({ action: "close" });
    check(closed.status === 200, "Закрытие production");
    await closed.text();
    const revoked = await request(qr.path, jar.unmarked);
    check(
      (await revoked.text()).includes("Код недействителен или устарел"),
      "Закрытый код недействителен",
    );
    const absent = (await records()).filter((row) => row.status === "absent");
    check(absent.length === 2, "Неотмеченные сохранены как absent");
    const lateRotation = await post({
      action: "issue",
      previousCode: qr.path.slice(8),
    });
    check(lateRotation.status === 409, "Запоздалая ротация после закрытия");
    await lateRotation.text();
    const reopened = await post({ action: "issue" });
    const newer = (await reopened.json()) as { path: string };
    check(reopened.status === 200, "Явное повторное открытие");
    await f.teacher
      .sql`update attendance_codes set created_at = now() - interval '31 seconds', expires_at = now() - interval '1 second' where slot_id = ${f.key.slotId}`;
    const expired = await request(newer.path, jar.unmarked);
    check(
      (await expired.text()).includes("Код недействителен или устарел"),
      "Просроченный код",
    );
    const points = await f.teacher.sql<
      { count: number }[]
    >`select count(*)::int as count from activity_points where student_id = ${f.student.actor.studentId}`;
    check(points[0]?.count === 1, "Ровно один балл");
    for (let i = 0; i < 20; i++) {
      const response = await post(
        { action: "issue" },
        jar.teacher,
        true,
        "198.51.100.1",
      );
      assert(response.status === 200, "Выдача до парного лимита");
      await response.text();
    }
    const issueLimited = await post(
      { action: "issue" },
      jar.teacher,
      true,
      "198.51.100.1",
    );
    check(issueLimited.status === 429, "Выдача лимитируется по IP");
    await issueLimited.text();
    const issueOtherIp = await post(
      { action: "issue" },
      jar.teacher,
      true,
      "198.51.100.2",
    );
    check(issueOtherIp.status === 200, "Выдача с другого IP остаётся доступна");
    await issueOtherIp.text();
    for (let i = 0; i < 10; i++) {
      const response = await post(
        { action: "close" },
        jar.teacher,
        true,
        "198.51.100.1",
      );
      assert(response.status === 200, "Закрытие до парного лимита");
      await response.text();
    }
    const closeLimited = await post(
      { action: "close" },
      jar.teacher,
      true,
      "198.51.100.1",
    );
    check(closeLimited.status === 429, "Закрытие лимитируется по IP");
    await closeLimited.text();
    const closeOtherIp = await post(
      { action: "close" },
      jar.teacher,
      true,
      "198.51.100.2",
    );
    check(
      closeOtherIp.status === 200,
      "Закрытие с другого IP остаётся доступно",
    );
    await closeOtherIp.text();
    for (let i = 0; i < 10; i++) {
      const response = await request(qr.path, jar.student, {
        method: "POST",
        headers: { ...actionHeaders, "X-Forwarded-For": "198.51.100.1" },
        body: await payload(),
      });
      assert(
        (await response.text()).includes('"messageCode":"invalidCode"'),
        "Отметка до парного лимита",
      );
    }
    const markLimited = await request(qr.path, jar.student, {
      method: "POST",
      headers: { ...actionHeaders, "X-Forwarded-For": "198.51.100.1" },
      body: await payload(),
    });
    check(
      (await markLimited.text()).includes('"messageCode":"rateLimited"'),
      "Отметка лимитируется по IP",
    );
    const markOtherIp = await request(qr.path, jar.student, {
      method: "POST",
      headers: { ...actionHeaders, "X-Forwarded-For": "198.51.100.2" },
      body: await payload(),
    });
    check(
      (await markOtherIp.text()).includes('"messageCode":"invalidCode"'),
      "Отметка с другого IP остаётся доступна",
    );
    const attempts = await f.teacher.sql<{ key: string }[]>`
      select key from login_attempts
      where key like ${`attendance:%:${f.teacher.actor.userId}%`}
        or key like ${`attendance:%:${f.student.actor.userId}%`}`;
    check(
      attempts.length > 0 &&
        attempts.every((row) =>
          /^attendance:(mark|issue|close):[a-f0-9-]{36}(?::[a-f0-9]{64})?$/.test(
            row.key,
          ),
        ),
      "Production-счётчики содержат только user_id и хэш IP",
    );
    return { checks };
  } finally {
    for (const id of ids) await sessions.revoke(id);
    for (const userId of [outsider.actor.userId, otherTeacher.actor.userId])
      await f.teacher
        .sql`delete from login_attempts where key like ${`attendance:%:${userId}%`}`;
    await otherTeacher.close();
    await outsider.close();
    await f.close();
  }
}
if (import.meta.main) {
  try {
    console.info(
      await checkAttendanceHttp(
        `http://127.0.0.1:${process.env.PORT || "3000"}`,
      ),
    );
  } catch (error) {
    console.error(
      error instanceof assert.AssertionError
        ? error.message
        : "Production HTTP посещаемости: FAIL. Коды и адреса скрыты.",
    );
    process.exitCode = 1;
  }
}
