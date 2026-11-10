import { expect, it } from "vitest";
import { explicitEventDates } from "@/application/assistant/event-fields";
import { PreviewEventRelease } from "@/application/requests/event-release";
import {
  assistantFixture,
  collect,
  threadId,
  toolRuntime,
} from "../fakes/assistant";
import { eventType } from "../fakes/requests-event";
import { FakeScheduleRepository, scheduleData } from "../fakes/schedule";

function fixture(runtime?: Parameters<typeof assistantFixture>[0]) {
  const f = assistantFixture(runtime);
  f.db.types.push(eventType);
  const schedule = new FakeScheduleRepository();
  if (f.actor.kind !== "student") throw new Error("Нужен студент");
  schedule.records.set(f.actor.studentId, scheduleData());
  f.deps.requests.previewEvent = new PreviewEventRelease(schedule, f.clock);
  f.deps.regulations.get.execute = async (_actor, { slug }) => ({
    slug,
    title: "Посещаемость",
    introduction: "Вымышленное положение конкурсного концепта",
    sections: [
      {
        section: "4",
        title: "Мероприятия",
        body: "Подайте заявку на освобождение. Не больше 14 дней включительно.",
        anchor: "p-4",
        href: "/regulations/attendance#p-4",
      },
    ],
  });
  return f;
}
it.each([
  ["15–16 ноября 2026", "2026-11-15", "2026-11-16"],
  ["15 ноября 2026", "2026-11-15", "2026-11-15"],
  ["2026-11-15 — 2026-11-16", "2026-11-15", "2026-11-16"],
  ["2026-11-15", "2026-11-15", "2026-11-15"],
  ["с 2026-11-15 по 2026-11-16", "2026-11-15", "2026-11-16"],
  ["2026-11-15 до 2026-11-16", "2026-11-15", "2026-11-16"],
  ["2026-11-15-2026-11-16", "2026-11-15", "2026-11-16"],
  ["15–16 ноября\n2026", "2026-11-15", "2026-11-16"],
])("явные даты из слов студента: %s", (words, dateFrom, dateTo) =>
  expect(explicitEventDates(words)).toEqual({ dateFrom, dateTo }),
);
it.each([
  "15–16 ноября",
  "скоро",
  "15–16 ноября 2026 или 2027",
  "1–16 ноября 2026",
  "2026-11-15, 2026-11-16, 2026-11-18",
  "31 ноября 2026",
  "15 декабря 2026 и 16 ноября 2026",
  "Еду на хакатон 15–16 ноября 2026. Приглашение от 2026-11-01.",
  "Еду на хакатон 2026-11-15. Приглашение от 2026-11-18.",
  "2026-11-15, 2026-11-16",
])("не угадывает даты: %s", (words) =>
  expect(explicitEventDates(words)).toBeNull(),
);
it.each(["2026", "15–16 ноября 2026"])(
  "mock без года переспрашивает; после уточнения «%s» готовит черновик с пустыми неизвестными полями и своими парами",
  async (clarification) => {
    const f = fixture();
    const question = "Еду на хакатон 15–16 ноября, что с парами?";
    const first = await collect(
      await f.ask.execute(f.actor, { action: "ask", threadId, question }),
    );
    expect(first).toContainEqual(
      expect.objectContaining({
        type: "source",
        source: expect.objectContaining({
          href: "/regulations/attendance#p-4",
        }),
      }),
    );
    expect(first).toContainEqual({
      type: "message",
      code: "clarifyEventDates",
      params: {},
    });
    expect(f.db.records).toHaveLength(0);
    const second = await collect(
      await f.ask.execute(f.actor, {
        action: "ask",
        threadId,
        question: clarification,
      }),
    );
    const card = second.find((event) => event.type === "draft");
    expect(card?.type === "draft" && card.draft).toMatchObject({
      source: { href: "/regulations/attendance#p-4" },
      canSubmit: false,
      fields: expect.arrayContaining([
        {
          name: "eventName",
          title: "Название мероприятия",
          required: true,
          value: "хакатон",
          format: undefined,
        },
        {
          name: "dateFrom",
          title: "Дата с",
          required: true,
          value: "2026-11-15",
          format: "date",
        },
        {
          name: "dateTo",
          title: "Дата по",
          required: true,
          value: "2026-11-16",
          format: "date",
        },
        {
          name: "organizer",
          title: "Организатор",
          required: true,
          value: "",
          format: undefined,
        },
        {
          name: "confirmation",
          title: "Подтверждение: ссылка или текст приглашения",
          required: true,
          value: "",
          format: undefined,
        },
      ]),
    });
    expect(card?.type === "draft" && card.draft.lessons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ course: "История международных отношений" }),
      ]),
    );
    expect(
      card?.type === "draft" &&
        card.draft.fields.slice(0, 6).map((field) => field.title),
    ).toEqual([
      "Название мероприятия",
      "Организатор",
      "Дата с",
      "Дата по",
      "Формат участия",
      "Подтверждение: ссылка или текст приглашения",
    ]);
    expect(f.db.records[0]?.payload).toMatchObject({
      dateFrom: "2026-11-15",
      dateTo: "2026-11-16",
    });
    expect(f.db.records[0]?.status).toBe("draft");
    expect(f.db.events).toHaveLength(0);
  },
);
it.each([
  ["Исправь даты: 17–18 ноября 2026", "2026-11-18"],
  ["Исправь даты: 2026-11-17 — 2026-11-18", "2026-11-18"],
  ["17–18 ноября", "2026-11-18"],
  ["17 ноября", "2026-11-17"],
])(
  "последнее сообщение исправляет даты того же черновика: %s",
  async (question, dateTo) => {
    const f = fixture(
      toolRuntime(({ tools }) =>
        tools.execute("draft_request", {
          type: "event_release",
          fields: {
            eventName: "хакатон",
            dateFrom: "2026-11-15",
            dateTo: "2026-11-16",
          },
        }),
      ),
    );
    const first = await collect(
      await f.ask.execute(f.actor, {
        action: "ask",
        threadId,
        question: "Еду на хакатон 15–16 ноября 2026",
      }),
    );
    const original = first.find((event) => event.type === "draft");
    expect(original?.type).toBe("draft");
    const response = await collect(
      await f.ask.execute(f.actor, { action: "ask", threadId, question }),
    );
    const corrected = response.find((event) => event.type === "draft");
    expect(f.db.records).toHaveLength(1);
    expect(corrected?.type === "draft" && corrected.draft.id).toBe(
      original?.type === "draft" && original.draft.id,
    );
    expect(corrected?.type === "draft" && corrected.draft.fields).toEqual(
      expect.arrayContaining([
        {
          name: "dateFrom",
          title: "Дата с",
          required: true,
          value: "2026-11-17",
          format: "date",
        },
        {
          name: "dateTo",
          title: "Дата по",
          required: true,
          value: dateTo,
          format: "date",
        },
        {
          name: "organizer",
          title: "Организатор",
          required: true,
          value: "",
          format: undefined,
        },
        {
          name: "confirmation",
          title: "Подтверждение: ссылка или текст приглашения",
          required: true,
          value: "",
          format: undefined,
        },
      ]),
    );
    expect(f.db.records[0]?.payload).toEqual({
      eventName: "хакатон",
      dateFrom: "2026-11-17",
      dateTo,
    });
    expect(f.db.events).toHaveLength(0);
  },
);

it.each([
  "Исправь даты: 17–18 ноября 2026 или 20–21 ноября 2026",
  "Исправь даты: 17–18 ноября 2026, 2026-11-20 — 2026-11-21",
  "Исправь даты: 31 ноября 2026",
  "Исправь даты: 18–17 ноября 2026",
  "Исправь даты: 1–16 ноября 2026",
])(
  "не подставляет прежние даты вместо неоднозначного уточнения: %s",
  async (question) => {
    const f = fixture(
      toolRuntime(({ tools }) =>
        tools.execute("draft_request", {
          type: "event_release",
          fields: { eventName: "хакатон" },
        }),
      ),
    );
    await collect(
      await f.ask.execute(f.actor, {
        action: "ask",
        threadId,
        question: "Еду на хакатон 15–16 ноября 2026",
      }),
    );
    const originalPayload = { ...f.db.records[0]?.payload };
    const response = await collect(
      await f.ask.execute(f.actor, { action: "ask", threadId, question }),
    );
    expect(response).toContainEqual({
      type: "message",
      code: "clarifyEventDates",
      params: {},
    });
    expect(response.some((event) => event.type === "draft")).toBe(false);
    expect(f.db.records).toHaveLength(1);
    expect(f.db.records[0]?.payload).toEqual(originalPayload);
    expect(f.db.events).toHaveLength(0);
  },
);

it("уточнение без года берёт год мероприятия, а не постороннего вопроса", async () => {
  const f = fixture(
    toolRuntime(async ({ question, tools }) => {
      if (question.startsWith("Экзамен")) return;
      return tools.execute("draft_request", {
        type: "event_release",
        fields: { eventName: "хакатон" },
      });
    }),
  );
  for (const question of [
    "Еду на хакатон 15–16 ноября 2026",
    "Экзамен будет в 2027 году",
  ])
    await collect(
      await f.ask.execute(f.actor, { action: "ask", threadId, question }),
    );
  const response = await collect(
    await f.ask.execute(f.actor, {
      action: "ask",
      threadId,
      question: "17–18 ноября",
    }),
  );
  expect(response.some((event) => event.type === "draft")).toBe(true);
  expect(f.db.records).toHaveLength(1);
  expect(f.db.records[0]?.payload).toEqual({
    eventName: "хакатон",
    dateFrom: "2026-11-17",
    dateTo: "2026-11-18",
  });
});

it("модель не подменяет даты и не додумывает организатора/подтверждение", async () => {
  const f = fixture(
    toolRuntime(async ({ tools }) =>
      tools.execute("draft_request", {
        type: "event_release",
        fields: {
          eventName: "хакатон",
          dateFrom: "2099-01-01",
          dateTo: "2099-01-02",
          organizer: "Несуществующий организатор",
          confirmation: "Выдуманное приглашение",
        },
      }),
    ),
  );
  await collect(
    await f.ask.execute(f.actor, {
      action: "ask",
      threadId,
      question: "Еду на хакатон 15–16 ноября 2026",
    }),
  );
  expect(f.db.records[0]?.payload).toEqual({
    eventName: "хакатон",
    dateFrom: "2026-11-15",
    dateTo: "2026-11-16",
  });
});
it("после вопроса о мероприятии можно спросить о расписании", async () => {
  const f = fixture();
  await collect(
    await f.ask.execute(f.actor, {
      action: "ask",
      threadId,
      question: "Еду на хакатон 15–16 ноября",
    }),
  );
  const response = await collect(
    await f.ask.execute(f.actor, {
      action: "ask",
      threadId,
      question: "Где следующая пара?",
    }),
  );
  expect(response).not.toContainEqual({
    type: "message",
    code: "clarifyEventDates",
    params: {},
  });
  expect(f.journal.entries.at(-1)?.tools).toContain("find_schedule");
});

it.each([
  "Еду на хакатон 15–16 ноября 2026. Приглашение от 2026-11-01.",
  "Еду на хакатон 2026-11-15. Приглашение от 2026-11-18.",
])(
  "при неоднозначном периоде переспрашивает и не создаёт черновик: %s",
  async (question) => {
    const f = fixture();
    const response = await collect(
      await f.ask.execute(f.actor, { action: "ask", threadId, question }),
    );
    expect(response).toContainEqual({
      type: "message",
      code: "clarifyEventDates",
      params: {},
    });
    expect(response.some((event) => event.type === "draft")).toBe(false);
    expect(f.db.records).toHaveLength(0);
  },
);

it.each([
  "Олимпиадная математика 15–16 ноября 2026: какие темы повторить?",
  "Конференция 15–16 ноября 2026: где посмотреть программу?",
  "Хакатон 15–16 ноября 2026: какие будут задания?",
  "Еду на хакатон 15–16 ноября 2026, не хочу оформлять заявку",
])("без ИИ информационный вопрос не создаёт черновик: %s", async (question) => {
  const f = fixture(
    toolRuntime(async () => {
      throw new Error("Тестовый отказ модели");
    }),
  );
  const response = await collect(
    await f.ask.execute(f.actor, { action: "ask", threadId, question }),
  );
  expect(response).toContainEqual({ type: "mode", mode: "fallback" });
  expect(response).toContainEqual(
    expect.objectContaining({
      type: "source",
      source: expect.objectContaining({ href: "/regulations/attendance#p-4" }),
    }),
  );
  expect(response.some((event) => event.type === "draft")).toBe(false);
  expect(f.db.records).toHaveLength(0);
  expect(f.journal.entries.at(-1)?.tools).not.toContain("draft_request");
});

it.each([
  "Нужно освобождение: еду на хакатон 15–16 ноября 2026",
  "Пропущу пары из-за конференции 15–16 ноября 2026",
  "Помоги оформить заявку на олимпиаду 15–16 ноября 2026",
])(
  "без ИИ явное намерение создаёт черновик, который отправляет человек: %s",
  async (question) => {
    const f = fixture(
      toolRuntime(async () => {
        throw new Error("Тестовый отказ модели");
      }),
    );
    const response = await collect(
      await f.ask.execute(f.actor, { action: "ask", threadId, question }),
    );
    expect(response).toContainEqual({ type: "mode", mode: "fallback" });
    expect(response).toContainEqual(
      expect.objectContaining({
        type: "source",
        source: expect.objectContaining({
          href: "/regulations/attendance#p-4",
        }),
      }),
    );
    expect(response.some((event) => event.type === "draft")).toBe(true);
    expect(f.db.records).toHaveLength(1);
    expect(f.db.records[0]).toMatchObject({
      typeCode: "event_release",
      status: "draft",
      payload: { dateFrom: "2026-11-15", dateTo: "2026-11-16" },
    });
    expect(f.db.events).toHaveLength(0);
  },
);
