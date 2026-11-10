import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { DraftCard } from "@/application/assistant/ports";
import { addDays, moscowDate, weekday } from "@/domain/schedule/dates";
import { openEventRequestFixture } from "./requests-event-data";

const origin = `http://127.0.0.1:${process.env.PORT || "3000"}`;
const f = await openEventRequestFixture();
let count = 0;
const groupId = f.ids.next(),
  slotId = f.ids.next();
let originalGroup: string | undefined;
const fieldNames = [
  "eventName",
  "organizer",
  "dateFrom",
  "dateTo",
  "eventFormat",
  "confirmation",
];
const fieldTitles = [
  "Название мероприятия",
  "Организатор",
  "Дата с",
  "Дата по",
  "Формат участия",
  "Подтверждение: ссылка или текст приглашения",
];
function ordered(positions: number[]) {
  assert.ok(
    positions.every(
      (position, index) =>
        position >= 0 &&
        (index === 0 || position > (positions[index - 1] ?? -1)),
    ),
  );
  count++;
}
function russianDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "long",
    year: "numeric",
  })
    .formatToParts(new Date(`${value}T00:00:00Z`))
    .filter((part) => ["day", "month", "year"].includes(part.type))
    .map((part) => part.value)
    .join(" ");
}
function displayedFields(body: string, dateFrom: string, dateTo: string) {
  ordered(fieldTitles.map((title) => body.indexOf(`>${title}</dt>`)));
  for (const date of [dateFrom, dateTo]) {
    assert.ok(body.includes(`>${russianDate(date)}</dd>`));
    count++;
    assert.ok(!body.includes(`>${date}</dd>`));
    count++;
  }
}
function eventResult(body: string, status: string, explanation: string) {
  const main = body
    .match(/<main\b[^>]*>([\s\S]*?)<\/main>/)?.[1]
    ?.replace(/<!--[\s\S]*?-->/g, "");
  assert.ok(main, "Нет содержимого страницы заявки");
  count++;
  const current = main.match(
    /<li\b[^>]*aria-current="step"[^>]*>[\s\S]*?<\/li>/,
  )?.[0];
  assert.ok(current?.includes(`${status} · текущий этап`));
  count++;
  assert.ok(current?.includes(explanation));
  count++;
  assert.ok(!main.includes("Электронная справка"));
  count++;
  assert.ok(!main.includes("бумажный документ"));
  count++;
  assert.ok(!/href="\/api\/requests\/[^/]+\/pdf"/.test(main));
  count++;
}

async function get(path: string, token: string) {
  const response = await fetch(`${origin}${path}`, {
    redirect: "manual",
    headers: {
      Cookie: `__Host-pulse-session=${token}`,
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Dest": "document",
    },
  });
  return { status: response.status, body: await response.text() };
}
async function ask(token: string, threadId: string, question: string) {
  const response = await fetch(`${origin}/api/assistant`, {
    method: "POST",
    headers: {
      Cookie: `__Host-pulse-session=${token}`,
      Origin: origin,
      "Content-Type": "application/json",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
    },
    body: JSON.stringify({ action: "ask", threadId, question }),
  });
  const body = await response.text();
  assert.equal(response.status, 200);
  count++;
  return body;
}
function draftCard(body: string) {
  const frames = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map(
      (line) =>
        JSON.parse(line.slice(6)) as {
          type?: string;
          data?: { type?: string; draft?: DraftCard };
        },
    );
  return frames.find(
    (frame) => frame.type === "data-assistant" && frame.data?.type === "draft",
  )?.data?.draft;
}
async function action(
  token: string,
  path: string,
  exportedName: string,
  input: unknown,
) {
  const manifest = JSON.parse(
    await readFile(".next/server/server-reference-manifest.json", "utf8"),
  ) as {
    node: Record<string, { exportedName?: string }>;
  };
  const action = Object.entries(manifest.node).find(
    ([, entry]) => entry.exportedName === exportedName,
  )?.[0];
  assert.ok(action, "Нет Server Action в production-сборке");
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      Cookie: `__Host-pulse-session=${token}`,
      Origin: origin,
      "Content-Type": "application/json",
      "Next-Action": action,
      Accept: "text/x-component",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
    },
    body: JSON.stringify([input]),
  });
  return { status: response.status, body: await response.text() };
}
async function changeStatus(token: string, id: string, to: string) {
  return action(
    token,
    `/staff/requests/${id}`,
    "changeStaffRequestStatusAction",
    { id, to },
  );
}
try {
  if (f.anna.kind !== "student") throw new Error("Нужен студент");
  const studentId = f.anna.studentId;
  const [profile] = await f.sql<
    { groupId: string }[]
  >`select group_id as "groupId" from students where id = ${studentId}`;
  assert.ok(profile);
  originalGroup = profile.groupId;
  const from = addDays(moscowDate(f.clock.now()), -2),
    to = addDays(from, 1);
  f.payload.dateFrom = from;
  f.payload.dateTo = to;
  await f.sql`insert into groups (id, program_id, title) select ${groupId}, program_id, ${`ТЕСТ-${groupId}`} from students where id = ${studentId}`;
  await f.sql`insert into schedule_slots (id, group_id, course_id, teacher_id, room_id, weekday, starts_at, ends_at, kind, week_parity)
    select ${slotId}, ${groupId}, course_id, teacher_id, room_id, ${weekday(from)}, '09:00', '10:30', kind, 'any' from schedule_slots where group_id = ${originalGroup} limit 1`;
  await f.sql`update students set group_id = ${groupId} where id = ${studentId}`;
  const anna = await f.session(f.anna),
    timur = await f.session(f.timur),
    staff = await f.session(f.limited);
  const catalog = await get("/requests/new", anna);
  assert.equal(catalog.status, 200);
  count++;
  assert.equal(
    (catalog.body.match(/href="\/requests\/new\?type=/g) ?? []).length,
    8,
  );
  count++;
  const form = await get("/requests/new?type=event_release", anna);
  assert.equal(form.status, 200);
  count++;
  assert.equal((form.body.match(/type="date"/g) ?? []).length, 2);
  count++;
  assert.ok(
    form.body.includes("Освобождение от занятий для участия в мероприятии"),
  );
  count++;
  assert.ok(form.body.includes("60 дней"));
  count++;
  ordered(fieldNames.map((name) => form.body.indexOf(`name="${name}"`)));
  const id = await f.createEvent();
  const beforeNotices =
    await f.sql`select id from notifications where link = ${`/requests/${id}`}`;
  const denied = await action(
    anna,
    `/requests/${id}`,
    "changeRequestStatusAction",
    { id, to: "ready" },
  );
  assert.ok(
    denied.body.includes('"status":403') && denied.body.includes("FORBIDDEN"),
  );
  count++;
  assert.equal((await f.get.execute(f.anna, { id })).status, "submitted");
  count++;
  assert.equal(
    (
      await f.sql`select id from attendance_records where source_key = ${`event:${id}`}`
    ).length,
    0,
  );
  count++;
  assert.equal(
    (
      await f.sql`select id from activity_points where source_key = ${`event:${id}`}`
    ).length,
    0,
  );
  count++;
  assert.deepEqual(
    await f.sql`select id from notifications where link = ${`/requests/${id}`}`,
    beforeNotices,
  );
  count++;
  for (const invalidDates of [
    {
      dateFrom: addDays(moscowDate(f.clock.now()), -15),
      dateTo: addDays(moscowDate(f.clock.now()), -14),
    },
    { dateFrom: "0000-01-01", dateTo: "0000-01-02" },
  ]) {
    const invalid = await action(
      anna,
      "/requests/new?type=event_release",
      "saveRequestDraftAction",
      {
        typeCode: "event_release",
        payload: { ...f.payload, ...invalidDates },
        review: true,
      },
    );
    assert.ok(invalid.body.includes("VALIDATION"));
    count++;
  }
  const detail = await get(`/requests/${id}`, anna);
  assert.equal(detail.status, 200);
  count++;
  assert.ok(detail.body.includes("Пары на время мероприятия"));
  count++;
  assert.ok(
    /<a\b[^>]*href="\/regulations\/attendance#p-4"[^>]*>Почему\?<\/a>/.test(
      detail.body,
    ),
  );
  count++;
  assert.ok(detail.body.includes(f.payload.eventName));
  count++;
  displayedFields(detail.body, from, to);
  const foreign = await get(`/requests/${id}`, timur);
  assert.equal(foreign.status, 404);
  count++;
  assert.ok(!foreign.body.includes(f.payload.eventName));
  count++;
  await f.sql`insert into schedule_changes (id, slot_id, date, kind, new_date, new_starts_at, new_ends_at, reason)
    values (${f.ids.next()}, ${slotId}, ${from}, 'moved', ${to}, '13:00', '14:30', 'Учебный перенос')`;
  await f.sql`insert into attendance_records (id, student_id, slot_id, occurrence_date, status, source, source_key, marked_at)
    values (${f.ids.next()}, ${studentId}, ${slotId}, ${from}, 'absent', 'demo', ${`test:${id}`}, ${f.clock.now().toISOString()})`;
  const staffView = await get(`/staff/requests/${id}`, staff);
  assert.equal(staffView.status, 200);
  count++;
  assert.ok(staffView.body.includes(f.payload.confirmation));
  count++;
  assert.ok(staffView.body.includes("Пары на время мероприятия"));
  count++;
  const [basis] = await f.sql<
    { title: string }[]
  >`select title from regulation_chunks where doc_slug = 'attendance' and section = '4'`;
  assert.ok(basis);
  assert.ok(
    staffView.body
      .replace(/<!--[\s\S]*?-->/g, "")
      .includes(`Основание: пункт 4 «${basis.title}» положения о посещаемости`),
  );
  count++;
  assert.ok(!/<a\b[^>]*href="\/regulations(?:\/|["?#])/.test(staffView.body));
  count++;
  assert.ok(!staffView.body.includes("Почему?"));
  count++;
  assert.ok(staffView.body.includes("Период в прошлом"));
  count++;
  assert.ok(staffView.body.includes("изменилось после подачи"));
  count++;
  assert.ok(staffView.body.includes("Отсутствие"));
  count++;
  displayedFields(staffView.body, from, to);
  for (const to of ["accepted", "in_progress", "ready"]) {
    const transition = await changeStatus(staff, id, to);
    assert.equal(transition.status, 200);
    assert.ok(transition.body.includes('"ok":true'));
    assert.equal((await f.get.execute(f.anna, { id })).status, to);
    count++;
  }
  const lessons = await f.preview.execute(f.anna, {
    dateFrom: f.payload.dateFrom,
    dateTo: f.payload.dateTo,
  });
  const marks =
    await f.sql`select * from attendance_records where source_key = ${`event:${id}`}`;
  assert.equal(marks.length, lessons.length);
  count++;
  assert.ok(
    marks.every(
      (row) => row.status === "excused" && row.reason === f.payload.eventName,
    ),
  );
  count++;
  assert.deepEqual(
    [
      ...(await f.sql`select points from activity_points where source_key = ${`event:${id}`}`),
    ],
    [{ points: 5 }],
  );
  count++;
  assert.equal(
    (
      await f.sql`select id from staff_audit_log where request_id = ${id} and action = 'request.ready'`
    ).length,
    1,
  );
  count++;
  const notice =
    await f.sql`select title from notifications where link = ${`/requests/${id}`} and title like 'Освобождение одобрено:%'`;
  assert.equal(
    notice[0]?.title,
    `Освобождение одобрено: ${lessons.length} пар — уважительная причина`,
  );
  count++;
  const readyExplanation =
    "Освобождение одобрено. Пары на время мероприятия отмечены как уважительные.";
  for (const [path, token] of [
    [`/requests/${id}`, anna],
    [`/staff/requests/${id}`, staff],
  ] as const) {
    const readyView = await get(path, token);
    assert.equal(readyView.status, 200);
    count++;
    eventResult(readyView.body, "Готова", readyExplanation);
    if (token === anna) {
      assert.equal(
        readyView.body
          .match(/Что происходит\?\s*<\/h2>\s*<p\b[^>]*>([\s\S]*?)<\/p>/)?.[1]
          ?.replace(/<!--[\s\S]*?-->/g, ""),
        readyExplanation,
      );
      count++;
    }
  }
  const issued = await changeStatus(staff, id, "issued");
  assert.equal(issued.status, 200);
  count++;
  assert.deepEqual(
    await f.sql`select * from attendance_records where source_key = ${`event:${id}`}`,
    marks,
  );
  count++;
  assert.equal(
    (
      await f.sql`select id from activity_points where source_key = ${`event:${id}`}`
    ).length,
    1,
  );
  count++;
  const issuedExplanation =
    "Заявка завершена. Пары на время мероприятия отмечены как уважительные. История обращения останется в вашем кабинете.";
  for (const [path, token] of [
    [`/requests/${id}`, anna],
    [`/staff/requests/${id}`, staff],
  ] as const) {
    const issuedView = await get(path, token);
    assert.equal(issuedView.status, 200);
    count++;
    eventResult(issuedView.body, "Выдана", issuedExplanation);
    if (token === anna) {
      assert.equal(
        issuedView.body
          .match(/Что происходит\?\s*<\/h2>\s*<p\b[^>]*>([\s\S]*?)<\/p>/)?.[1]
          ?.replace(/<!--[\s\S]*?-->/g, ""),
        issuedExplanation,
      );
      count++;
    }
  }
  const certificateId = await f.request();
  for (const to of ["accepted", "in_progress", "ready"]) {
    const transition = await changeStatus(staff, certificateId, to);
    assert.equal(transition.status, 200);
    assert.ok(transition.body.includes('"ok":true'));
    count++;
  }
  const certificateView = await get(`/requests/${certificateId}`, anna);
  assert.equal(certificateView.status, 200);
  count++;
  assert.ok(
    certificateView.body.includes(
      "Документ готов. Скачайте PDF — получатель проверит его по QR-коду.",
    ),
  );
  count++;
  assert.ok(
    certificateView.body.includes(`href="/api/requests/${certificateId}/pdf"`),
  );
  count++;
  assert.ok(!certificateView.body.includes("Освобождение одобрено."));
  count++;
  const staffCertificateView = await get(
    `/staff/requests/${certificateId}`,
    staff,
  );
  assert.equal(staffCertificateView.status, 200);
  count++;
  const certificateMain = staffCertificateView.body
    .match(/<main\b[^>]*>([\s\S]*?)<\/main>/)?.[1]
    ?.replace(/<!--[\s\S]*?-->/g, "");
  assert.ok(certificateMain);
  count++;
  const certificateCurrent = certificateMain.match(
    /<li\b[^>]*aria-current="step"[^>]*>[\s\S]*?<\/li>/,
  )?.[0];
  assert.ok(certificateCurrent?.includes("Готова · текущий этап"));
  count++;
  assert.ok(
    certificateCurrent?.includes(
      "Результат готов. Электронная справка доступна в кабинете, бумажный документ — в деканате.",
    ),
  );
  count++;
  assert.ok(!certificateMain.includes("Освобождение одобрено."));
  count++;
  assert.ok(!/href="\/api\/requests\/[^/]+\/pdf"/.test(certificateMain));
  count++;
  const foreignId = await f.createEvent(true, f.timur);
  const otherFaculty = await get(`/staff/requests/${foreignId}`, staff);
  assert.equal(otherFaculty.status, 404);
  count++;
  assert.ok(!otherFaculty.body.includes(f.payload.eventName));
  count++;
  const blocked = await changeStatus(staff, foreignId, "accepted");
  assert.equal(blocked.status, 404);
  count++;
  assert.ok(!blocked.body.includes(f.payload.eventName));
  count++;
  const regulation = await get("/regulations/attendance", anna);
  assert.equal(regulation.status, 200);
  count++;
  for (const section of [2, 3, 4, 5]) {
    assert.ok(regulation.body.includes(`id="p-${section}"`));
    count++;
  }
  const thread = f.ids.next();
  const clarification = await ask(
    anna,
    thread,
    "Еду на хакатон 15–16 ноября, что с парами?",
  );
  assert.ok(clarification.includes("год"));
  count++;
  assert.ok(clarification.includes("/regulations/attendance#p-4"));
  count++;
  assert.ok(!draftCard(clarification));
  count++;
  const draft = await ask(anna, thread, "15–16 ноября 2026");
  assert.ok(
    draft.includes(russianDate("2026-11-15")) &&
      draft.includes(russianDate("2026-11-16")),
  );
  count++;
  const card = draftCard(draft);
  assert.ok(card);
  count++;
  assert.deepEqual(
    card.fields.slice(0, 6).map((field) => field.title),
    fieldTitles,
  );
  count++;
  assert.equal(card.fields[2]?.value, russianDate("2026-11-15"));
  count++;
  assert.equal(card.fields[3]?.value, russianDate("2026-11-16"));
  count++;
  assert.ok(draft.includes("Пары на время мероприятия"));
  count++;
  const corrected = await ask(anna, thread, "Исправь даты: 17–18 ноября 2026");
  const correctedCard = draftCard(corrected);
  assert.ok(correctedCard);
  count++;
  assert.equal(correctedCard.id, card.id);
  count++;
  assert.equal(correctedCard.fields[2]?.value, russianDate("2026-11-17"));
  count++;
  assert.equal(correctedCard.fields[3]?.value, russianDate("2026-11-18"));
  count++;
  const ambiguousCorrection = await ask(
    anna,
    thread,
    "Исправь даты: 17–18 ноября 2026 или 20–21 ноября 2026",
  );
  assert.ok(ambiguousCorrection.includes("Уточните точные даты и год"));
  count++;
  assert.ok(!draftCard(ambiguousCorrection));
  count++;
  for (const question of [
    "Еду на хакатон 15–16 ноября 2026. Приглашение от 2026-11-01.",
    "Еду на хакатон 2026-11-15. Приглашение от 2026-11-18.",
  ]) {
    const ambiguous = await ask(anna, f.ids.next(), question);
    assert.ok(ambiguous.includes("Уточните точные даты и год"));
    count++;
    assert.ok(!ambiguous.includes('"type":"draft"'));
    count++;
  }
  if (f.anna.kind !== "student") throw new Error("Нужен студент");
  const rows =
    await f.sql`select status, payload from requests where student_id = ${f.anna.studentId} and type_code = 'event_release' and payload->>'eventName' = 'хакатон'`;
  assert.equal(rows.length, 1);
  count++;
  assert.equal(rows[0]?.status, "draft");
  count++;
  assert.equal(rows[0]?.payload.dateFrom, "2026-11-17");
  count++;
  assert.equal(rows[0]?.payload.dateTo, "2026-11-18");
  count++;
  assert.ok(!rows[0]?.payload.organizer && !rows[0]?.payload.confirmation);
  count++;
  process.stdout.write(`Production HTTP: ${count} проверок PASS\n`);
} finally {
  try {
    if (f.anna.kind === "student" && originalGroup) {
      await f.sql`delete from attendance_records where slot_id = ${slotId}`;
      await f.sql`delete from schedule_changes where slot_id = ${slotId}`;
      await f.sql`update students set group_id = ${originalGroup} where id = ${f.anna.studentId}`;
      await f.sql`delete from schedule_slots where id = ${slotId}`;
      await f.sql`delete from groups where id = ${groupId}`;
    }
  } finally {
    await f.close();
  }
}
