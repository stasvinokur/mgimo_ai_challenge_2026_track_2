import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { addDays, moscowDate, weekday } from "@/domain/schedule/dates";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresSessionStore } from "@/infrastructure/db/repositories/identity/sessions";
import { certificatePdfText } from "../unit/certificates-pdf-text";
import { openCertificatesFixture } from "./certificates-fixture";
import { openPickupFixture } from "./pickup-data";
import { openEventRequestFixture } from "./requests-event-data";

const origin = `http://localhost:${process.env.PORT || "3000"}`;
const sql = createDatabase(1);
const sessionIds: string[] = [];
const closeFixtures: (() => Promise<void>)[] = [];
let passed = 0;

function check(condition: unknown, message: string): asserts condition {
  assert.ok(condition, message);
  passed++;
}

async function session(userId: string) {
  const tokens = new CryptoSessionTokens();
  const token = tokens.generate();
  const id = randomUUID();
  const now = new Date().toISOString();
  await new PostgresSessionStore(() => sql).create({
    id,
    userId,
    tokenHash: tokens.hash(token),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  sessionIds.push(id);
  return token;
}

async function get(path: string, language: "ru" | "en", token: string) {
  const response = await fetch(new URL(path, origin), {
    redirect: "manual",
    headers: {
      Accept: path.endsWith("/pdf") ? "application/pdf" : "text/html",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Dest": "document",
      Cookie: `__Host-pulse-session=${token}; pulse-language=${language}`,
    },
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const html = new TextDecoder().decode(bytes);
  const visible = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  check(
    response.headers.get("cache-control")?.includes("no-store"),
    `Ответ ${path} должен запрещать кеширование`,
  );
  return { response, html, visible, bytes };
}

function labels(html: string) {
  return [...html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)].map((match) =>
    (match[1] ?? "").replace(/<[^>]*>/g, "").trim(),
  );
}

async function cleanup() {
  try {
    const sessions = await Promise.allSettled(
      sessionIds.map((id) => sql`delete from sessions where id = ${id}`),
    );
    const fixtures = await Promise.allSettled(
      closeFixtures.reverse().map((close) => close()),
    );
    const failures = [...sessions, ...fixtures].flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length)
      throw new AggregateError(failures, "Не удалось убрать временные данные.");
  } finally {
    await sql.end({ timeout: 1 });
  }
}

const catalog = [
  {
    code: "event_release",
    ru: "Освобождение от занятий для участия в мероприятии",
    en: "Event attendance exemption",
    fields: [
      ["Название мероприятия", "Event name", true],
      ["Организатор", "Organiser", true],
      ["Дата с", "From date", true],
      ["Дата по", "To date", true],
      ["Формат участия", "Participation format", true],
      [
        "Подтверждение: ссылка или текст приглашения",
        "Confirmation: link or invitation text",
        true,
      ],
    ],
  },
  {
    code: "enrollment",
    ru: "Справка об обучении",
    en: "Certificate of enrolment",
    fields: [["Место требования", "Recipient", true]],
  },
  {
    code: "military",
    ru: "Справка для военкомата",
    en: "Military office certificate",
    fields: [["Военкомат", "Military registration office", true]],
  },
  {
    code: "visa",
    ru: "Справка для визы",
    en: "Visa certificate",
    fields: [
      ["Место требования", "Recipient", true],
      ["Страна", "Country", false],
    ],
  },
  {
    code: "scholarship",
    ru: "Справка о стипендии",
    en: "Scholarship certificate",
    fields: [["Место требования", "Recipient", true]],
  },
  {
    code: "retake",
    ru: "Заявление на пересдачу",
    en: "Resit request",
    fields: [
      ["Дисциплина", "Course", true],
      ["Причина", "Reason", true],
    ],
  },
  {
    code: "academic_leave",
    ru: "Заявление на академотпуск",
    en: "Academic leave request",
    fields: [
      ["Причина", "Reason", true],
      ["Желаемый период", "Requested period", true],
    ],
  },
  {
    code: "enrollment_paper",
    ru: "Бумажная справка об обучении с печатью",
    en: "Stamped paper certificate of enrolment",
    fields: [["Место требования", "Recipient", true]],
  },
  {
    code: "question",
    ru: "Вопрос в деканат",
    en: "Question for the dean’s office",
    fields: [["Ваш вопрос", "Your question", true]],
  },
] as const;

try {
  const certificates = await openCertificatesFixture();
  closeFixtures.push(() => certificates.close());
  const anna = await session(certificates.anna.actor.userId);
  const timur = await session(certificates.timur.actor.userId);
  const ready = await certificates.request();
  check(ready.certificate, "Нужна готовая справка временного студента");
  const submitted = await certificates.request("submitted");
  const draftId = await certificates.staff.request(
    certificates.anna.actor,
    true,
  );
  for (const language of ["ru", "en"] as const) {
    const view = await get("/requests/new", language, anna);
    check(view.response.status === 200, "Каталог должен отвечать HTTP 200");
    check(
      view.html.includes(`<html lang="${language}"`),
      "Язык HTML совпадает с cookie",
    );
    check(
      (view.visible.match(/href="\/requests\/new\?type=/g) ?? []).length === 9,
      "В демо-каталоге девять типов заявок",
    );
    for (const type of catalog) {
      check(
        view.visible.includes(type[language]),
        `Название каталога ${type.code}: ${language}`,
      );
      const form = await get(`/requests/new?type=${type.code}`, language, anna);
      check(
        form.response.status === 200,
        `Форма ${type.code} должна отвечать HTTP 200`,
      );
      check(
        form.visible.includes(type[language]),
        `Заголовок формы ${type.code}: ${language}`,
      );
      const actualLabels = labels(form.visible);
      for (const [ru, en, required] of type.fields) {
        const suffix =
          language === "ru"
            ? required
              ? " (обязательно)"
              : " (необязательно)"
            : required
              ? " (required)"
              : " (optional)";
        check(
          actualLabels.includes(`${language === "ru" ? ru : en}${suffix}`),
          `Поле ${type.code}/${en}: ${language}`,
        );
      }
      if (type.code === "event_release") {
        const eventLabels = type.fields.map(
          ([ru, en]) =>
            `${language === "ru" ? ru : en}${language === "ru" ? " (обязательно)" : " (required)"}`,
        );
        check(
          eventLabels.every(
            (label, index) =>
              actualLabels.indexOf(label) <
                actualLabels.indexOf(eventLabels[index + 1] ?? "") ||
              index === eventLabels.length - 1,
          ),
          `Порядок полей освобождения: ${language}`,
        );
      }
    }
    const draft = await get(`/requests/${draftId}`, language, anna);
    check(
      draft.response.status === 200,
      "Черновик должен открываться владельцу",
    );
    check(
      draft.visible.includes(
        language === "en" ? "Save draft" : "Сохранить черновик",
      ),
      "Черновик переведён",
    );
    const tracker = await get(`/requests/${submitted.id}`, language, anna);
    check(
      tracker.response.status === 200,
      "Трекер должен открываться владельцу",
    );
    check(
      tracker.visible.includes(
        language === "en" ? "Request progress" : "Путь заявки",
      ),
      "Заголовок трекера переведён",
    );
    check(
      tracker.visible.includes(
        language === "en"
          ? "Submitted · current stage"
          : "Подана · текущий этап",
      ),
      "Текущий этап переведён",
    );
    const certificate = await get(`/requests/${ready.id}`, language, anna);
    check(
      certificate.response.status === 200,
      "Готовая справка должна открываться владельцу",
    );
    check(
      certificate.visible.includes(
        language === "en" ? "Certificate ready" : "Готовая справка",
      ),
      "Карточка справки переведена",
    );
    check(
      certificate.visible.includes(`href="/api/requests/${ready.id}/pdf"`),
      "В карточке есть PDF",
    );
    check(
      certificate.visible.includes(`data:image/png;base64,`),
      "Карточка содержит QR",
    );
    if (language === "en")
      check(
        certificate.visible.includes(
          "The PDF certificate and the request sent to the dean’s office remain in Russian.",
        ),
        "Студент предупреждён о русском PDF",
      );
    const pdf = await get(`/api/requests/${ready.id}/pdf`, language, anna);
    check(pdf.response.status === 200, "PDF должен открываться владельцу");
    check(
      new TextDecoder().decode(pdf.bytes.slice(0, 4)) === "%PDF",
      "Скачан PDF",
    );
    const text = await certificatePdfText(pdf.bytes);
    check(
      text.includes("Вымышленная справка конкурсного концепта"),
      "PDF остаётся русским",
    );
    check(text.includes(ready.certificate.number), "В PDF номер своей справки");
    for (const path of [
      `/requests/${ready.id}`,
      `/api/requests/${ready.id}/pdf`,
      `/requests/${draftId}`,
    ]) {
      const foreign = await get(path, language, timur);
      check(foreign.response.status === 404, `IDOR ${path}: ${language} → 404`);
      check(
        !foreign.visible.includes(ready.certificate.number),
        "Чужой номер справки не раскрывается",
      );
    }
  }

  const pickup = await openPickupFixture();
  closeFixtures.push(() => pickup.close());
  const pickupAnna = await session(pickup.anna.userId);
  const pickupTimur = await session(pickup.timur.userId);
  const pickupId = await pickup.ready();
  const options = await pickup.getPickup.execute(pickup.anna, { id: pickupId });
  const window = options.windows.find((item) => item.id === pickup.windowId);
  const slot = window?.slots[0];
  check(slot, "Нужен свободный слот тестового окна");
  for (const language of ["ru", "en"] as const) {
    const view = await get(`/requests/${pickupId}`, language, pickupAnna);
    check(view.response.status === 200, "Запись в очередь доступна владельцу");
    for (const title of language === "en"
      ? [
          "Collection window",
          "Collection date",
          "Collection time (MSK)",
          "Book collection",
        ]
      : [
          "Окно выдачи",
          "Дата получения",
          "Время получения (МСК)",
          "Записаться на получение",
        ])
      check(view.visible.includes(title), `Подпись очереди ${title}`);
  }
  const booking = await pickup.book.execute(pickup.anna, {
    id: pickupId,
    windowId: pickup.windowId,
    slotStartsAt: slot,
  });
  for (const language of ["ru", "en"] as const) {
    const ticket = await get(`/requests/${pickupId}`, language, pickupAnna);
    check(ticket.response.status === 200, "Талон доступен владельцу");
    check(
      ticket.visible.includes(booking.ticketNo),
      "Показан свой номер талона",
    );
    check(ticket.visible.includes(pickup.marker), "Имя окна из БД сохранено");
    check(
      ticket.visible.includes(
        language === "en" ? "Reschedule" : "Перенести запись",
      ),
      "Действие переноса переведено",
    );
    const foreign = await get(`/requests/${pickupId}`, language, pickupTimur);
    check(foreign.response.status === 404, "Чужая бумажная справка → 404");
    check(
      !foreign.visible.includes(booking.ticketNo),
      "Чужой талон не раскрывается",
    );
  }
  await pickup.bringToToday(booking.id);
  await pickup.changePickup.execute(pickup.limited, {
    id: booking.id,
    to: "called",
  });
  for (const language of ["ru", "en"] as const) {
    const called = await get(`/requests/${pickupId}`, language, pickupAnna);
    check(called.response.status === 200, "Вызов доступен владельцу");
    check(
      called.visible.includes(
        language === "en" ? "Please go to" : "Вас вызывают в",
      ),
      "Вызов переведён",
    );
  }

  const event = await openEventRequestFixture();
  closeFixtures.push(() => event.close());
  const today = moscowDate(event.clock.now());
  event.payload.dateFrom = addDays(today, (8 - weekday(today)) % 7);
  event.payload.dateTo = addDays(event.payload.dateFrom, 6);
  const eventAnna = await session(event.anna.userId);
  const eventTimur = await session(event.timur.userId);
  const staff = await session(event.limited.userId);
  const eventId = await event.createEvent();
  const lessons = await event.preview.execute(event.anna, {
    dateFrom: event.payload.dateFrom,
    dateTo: event.payload.dateTo,
  });
  check(lessons.length > 0, "В периоде освобождения есть пары");
  for (const language of ["ru", "en"] as const) {
    const view = await get(`/requests/${eventId}`, language, eventAnna);
    check(view.response.status === 200, "Освобождение доступно владельцу");
    check(
      view.visible.includes(
        language === "en"
          ? "Classes during the event"
          : "Пары на время мероприятия",
      ),
      "Список пар переведён",
    );
    check(
      view.visible.includes(event.payload.eventName),
      "Название мероприятия не изменяется",
    );
    for (const lesson of lessons)
      check(
        view.visible.includes(lesson.course),
        "Название дисциплины из БД не изменяется",
      );
    const foreign = await get(`/requests/${eventId}`, language, eventTimur);
    check(foreign.response.status === 404, "Чужое освобождение → 404");
    check(
      !foreign.visible.includes(event.payload.eventName),
      "Чужое мероприятие не раскрывается",
    );
  }
  await event.progress(eventId);
  await event.change.execute(event.limited, { id: eventId, to: "ready" });
  const eventReady = await get(`/requests/${eventId}`, "en", eventAnna);
  check(
    eventReady.visible.includes("Your exemption has been approved."),
    "Результат освобождения переведён",
  );
  check(
    !eventReady.visible.includes(`/api/requests/${eventId}/pdf`),
    "Освобождение не предлагает PDF-справку",
  );
  const staffView = await get(`/staff/requests/${eventId}`, "en", staff);
  check(
    staffView.response.status === 200,
    "Сотрудник видит заявку своего факультета",
  );
  for (const title of [
    "Пары на время мероприятия",
    "Название мероприятия",
    "Организатор",
    "Готова · текущий этап",
    "Освобождение одобрено.",
  ])
    check(
      staffView.visible.includes(title),
      "Представление сотрудника остаётся русским",
    );
  check(
    staffView.visible.includes(event.payload.eventName),
    "Сотрудник получает исходные данные заявки",
  );
  check(
    staffView.visible.includes("This interface is available in Russian."),
    "Сотрудник видит пометку о русском интерфейсе",
  );
} finally {
  await cleanup();
}

process.stdout.write(
  `Production HTTP requests i18n: ${passed}/${passed} PASS; временные данные удалены.\n`,
);
