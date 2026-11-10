import type * as s from "../../src/infrastructure/db/schema/notifications";
import { type FixtureContext, moscowDate } from "./shared";
import { demoGroups } from "./student";

export function notificationFixtures(ctx: FixtureContext) {
  const studyDate =
    moscowDate(ctx.studyDay) === ctx.today
      ? "Сегодня"
      : new Intl.DateTimeFormat("ru-RU", {
          timeZone: "Europe/Moscow",
          day: "numeric",
          month: "long",
        }).format(ctx.studyDay);
  const minutesBefore = (minutes: number) =>
    new Date(ctx.now.getTime() - minutes * 60_000);
  const notifications: (typeof s.notifications.$inferInsert)[] = [
    {
      ...ctx.row("notification:anna:change"),
      userId: ctx.row("user:anna").id,
      kind: "change",
      priority: "high",
      title: "Пара перенесена",
      body: `${studyDate}: занятие перенесено на 13:00, аудитория ДЕМО-102.`,
      link: "/schedule",
      createdAt: minutesBefore(18),
    },
    {
      ...ctx.row("notification:anna:deadline"),
      userId: ctx.row("user:anna").id,
      kind: "deadline",
      priority: "high",
      title: "Остался итоговый тест",
      body: "Чтобы сохранить повышенную стипендию, нужно не менее 77 из 100 по иностранному языку. Срок — через 3 дня.",
      link: "/grades",
      createdAt: minutesBefore(53),
    },
    {
      ...ctx.row("notification:anna:request"),
      userId: ctx.row("user:anna").id,
      kind: "request",
      priority: "normal",
      title: "Справка об обучении готова",
      body: "Откройте заявку, чтобы получить справку.",
      link: `/requests/${ctx.row("request:0").id}`,
      createdAt: minutesBefore(95),
    },
    {
      ...ctx.row("notification:timur:debt"),
      userId: ctx.row("user:timur").id,
      kind: "alert",
      priority: "high",
      title: "Нужно закрыть обязательную работу",
      body: "Контрольная по основам маркетинга просрочена. Без неё нельзя получить зачёт. Уточните возможность сдачи.",
      link: "/grades",
      createdAt: minutesBefore(24),
    },
    {
      ...ctx.row("notification:timur:deadline"),
      userId: ctx.row("user:timur").id,
      kind: "deadline",
      priority: "high",
      title: "Тест через 2 дня",
      body: "По математике для бизнеса открыт итоговый тест. Запланируйте время на подготовку.",
      link: "/grades",
      createdAt: minutesBefore(72),
    },
    {
      ...ctx.row("notification:marina:queue"),
      userId: ctx.row("user:marina").id,
      kind: "alert",
      priority: "high",
      title: "Проверьте очередь заявок",
      body: "Есть заявки с прошедшим сроком и сроком в ближайший рабочий день.",
      link: "/staff/requests",
      createdAt: minutesBefore(41),
    },
  ];
  const announcements: (typeof s.announcements.$inferInsert)[] = [
    {
      ...ctx.row("announcement:all"),
      audience: "all",
      audienceRef: null,
      title: "Добро пожаловать в «Пульс»",
      body: "Все данные и правила в этом конкурсном концепте вымышлены. Учебные вопросы можно задать через раздел заявок.",
      publishedAt: ctx.at(-1, 9),
    },
    ...demoGroups.map((group) => ({
      ...ctx.row(`announcement:${group}`),
      audience: "group" as const,
      audienceRef: ctx.row(`group:${group}`).id,
      title: "Открыта запись на консультацию",
      body: "Выберите удобное время через «Вопрос в деканат». Ближайшая консультация — через 2 дня.",
      publishedAt: ctx.at(0, 7),
    })),
  ];
  return { notifications, announcements };
}
