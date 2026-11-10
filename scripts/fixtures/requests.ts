import type * as s from "../../src/infrastructure/db/schema/requests";
import { addWorkDays, type FixtureContext } from "./shared";

export function requestFixtures(ctx: FixtureContext) {
  const field = (title: string, maxLength = 500) => ({
    type: "string",
    title,
    minLength: 1,
    maxLength,
  });
  const schema = (
    properties: Record<string, unknown>,
    required: string[],
    fieldOrder?: string[],
  ) => ({
    type: "object",
    properties,
    required,
    ...(fieldOrder ? { fieldOrder } : {}),
    additionalProperties: false,
  });
  const eventFieldOrder = [
    "eventName",
    "organizer",
    "dateFrom",
    "dateTo",
    "eventFormat",
    "confirmation",
  ];
  const catalog = [
    {
      code: "event_release",
      title: "Освобождение от занятий для участия в мероприятии",
      description:
        "Хакатон, олимпиада или конференция: согласуйте уважительную причину",
      slaWorkDays: 3,
      delivery: "pickup",
      isCertificate: false,
      fieldsSchema: schema(
        {
          eventName: field("Название мероприятия", 300),
          organizer: field("Организатор", 300),
          dateFrom: { ...field("Дата с", 10), format: "date" },
          dateTo: { ...field("Дата по", 10), format: "date" },
          eventFormat: field("Формат участия", 100),
          confirmation: field(
            "Подтверждение: ссылка или текст приглашения",
            2000,
          ),
        },
        eventFieldOrder,
        eventFieldOrder,
      ),
    },
    {
      code: "enrollment",
      title: "Справка об обучении",
      description: "По месту требования",
      slaWorkDays: 3,
      delivery: "pdf",
      isCertificate: true,
      fieldsSchema: schema({ destination: field("Место требования") }, [
        "destination",
      ]),
    },
    {
      code: "military",
      title: "Справка для военкомата",
      description: "Подтверждение обучения для военкомата",
      slaWorkDays: 5,
      delivery: "pickup",
      isCertificate: true,
      fieldsSchema: schema({ office: field("Военкомат") }, ["office"]),
    },
    {
      code: "visa",
      title: "Справка для визы",
      description: "Подтверждение обучения для визового обращения",
      slaWorkDays: 5,
      delivery: "pdf",
      isCertificate: true,
      fieldsSchema: schema(
        {
          destination: field("Место требования"),
          country: field("Страна"),
        },
        ["destination"],
      ),
    },
    {
      code: "scholarship",
      title: "Справка о стипендии",
      description: "Сведения о назначенной стипендии",
      slaWorkDays: 3,
      delivery: "pdf",
      isCertificate: true,
      fieldsSchema: schema({ destination: field("Место требования") }, [
        "destination",
      ]),
    },
    {
      code: "retake",
      title: "Заявление на пересдачу",
      description: "Согласование повторной аттестации",
      slaWorkDays: 3,
      delivery: "pickup",
      isCertificate: false,
      fieldsSchema: schema(
        { course: field("Дисциплина"), reason: field("Причина") },
        ["course", "reason"],
      ),
    },
    {
      code: "academic_leave",
      title: "Заявление на академотпуск",
      description: "Рассмотрение перерыва в обучении",
      slaWorkDays: 10,
      delivery: "pickup",
      isCertificate: false,
      fieldsSchema: schema(
        { reason: field("Причина"), period: field("Желаемый период") },
        ["reason", "period"],
      ),
    },
    {
      code: "enrollment_paper",
      title: "Бумажная справка об обучении с печатью",
      description: "Оригинал справки с печатью для получения в деканате",
      slaWorkDays: 3,
      delivery: "pickup",
      isCertificate: true,
      fieldsSchema: schema(
        { destination: field("Место требования") },
        ["destination"],
        ["destination"],
      ),
    },
    {
      code: "question",
      title: "Вопрос в деканат",
      description: "Поможем разобраться с учебным вопросом",
      slaWorkDays: 5,
      delivery: "pickup",
      isCertificate: false,
      fieldsSchema: schema({ question: field("Ваш вопрос", 2000) }, [
        "question",
      ]),
    },
  ] satisfies (typeof s.requestTypes.$inferInsert)[];
  const requestTypes = catalog.map((row) => ({
    ...row,
    seedKey: `demo:type:${row.code}`,
  }));
  const scenarios = [
    {
      student: "anna",
      type: "enrollment",
      status: "ready",
      due: 2,
      payload: { destination: "По месту требования" },
    },
    {
      student: "anna",
      type: "scholarship",
      status: "in_progress",
      due: 1,
      payload: { destination: "В учебный центр «Горизонт» (вымышленный)" },
    },
    {
      student: "extra-1",
      type: "visa",
      status: "submitted",
      due: -1,
      payload: { destination: "Визовый центр «Меридиан» (вымышленный)" },
    },
    {
      student: "extra-2",
      type: "military",
      status: "accepted",
      due: 1,
      payload: { office: "Учебный военкомат «Роща» (вымышленный)" },
    },
    {
      student: "extra-3",
      type: "retake",
      status: "in_progress",
      due: -1,
      payload: {
        course: "Мировая экономика",
        reason: "Прошу согласовать дату повторной аттестации",
      },
    },
    {
      student: "extra-7",
      type: "academic_leave",
      status: "needs_info",
      due: 3,
      payload: {
        reason: "Личные обстоятельства в демо-сценарии",
        period: "Один учебный семестр",
      },
    },
    {
      student: "extra-8",
      type: "question",
      status: "submitted",
      due: 3,
      payload: { question: "Где уточнить график консультаций?" },
    },
    {
      student: "extra-9",
      type: "enrollment",
      status: "accepted",
      due: 2,
      payload: { destination: "По месту требования" },
    },
    {
      student: "anna",
      type: "enrollment_paper",
      status: "ready",
      due: 2,
      payload: { destination: "По месту требования" },
    },
  ] as const;
  const requests: (typeof s.requests.$inferInsert)[] = [];
  const requestEvents: (typeof s.requestEvents.$inferInsert)[] = [];
  scenarios.forEach((scenario, i) => {
    const type = requestTypes.find((row) => row.code === scenario.type);
    if (!type) throw new Error("Отсутствует тип демо-заявки.");
    const dueAt = addWorkDays(ctx.at(0, 17), scenario.due);
    const submittedAt = addWorkDays(dueAt, -type.slaWorkDays);
    const request = {
      ...ctx.row(`request:${i}`),
      publicNo: `З-2026-${String(i + 1).padStart(6, "0")}`,
      studentId: ctx.row(`student:${scenario.student}`).id,
      typeCode: scenario.type,
      payload: scenario.payload,
      status: scenario.status,
      assigneeStaffId:
        scenario.status === "submitted" ? null : ctx.row("staff:marina").id,
      submittedAt,
      dueAt,
      createdAt: submittedAt,
      updatedAt: new Date(submittedAt.getTime() + 3_600_000),
    };
    requests.push(request);
    const path = [
      "submitted",
      "accepted",
      "in_progress",
      scenario.status === "needs_info" ? "needs_info" : "ready",
    ] as const;
    const stop = path.indexOf(scenario.status);
    for (let step = 0; step <= stop; step++) {
      const status = path[step];
      if (!status) continue;
      requestEvents.push({
        ...ctx.row(`event:${i}:${step}`),
        requestId: request.id,
        fromStatus: step === 0 ? "draft" : path[step - 1],
        toStatus: status,
        actorUserId: ctx.row(
          `user:${step === 0 && scenario.student === "anna" ? "anna" : "marina"}`,
        ).id,
        comment:
          status === "needs_info"
            ? "Уточните желаемый период перерыва."
            : step === 0 && scenario.student !== "anna"
              ? "Демо-заявка зарегистрирована сотрудником."
              : null,
        at: new Date(submittedAt.getTime() + step * 60_000),
      });
    }
  });
  return { requestTypes, requests, requestEvents };
}
