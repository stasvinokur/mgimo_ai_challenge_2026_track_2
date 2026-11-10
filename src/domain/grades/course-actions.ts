import { exactWeightedTotal, type GradeWork } from "./grading-policy";
import { trafficLight } from "./traffic-light";
import { whatIf } from "./what-if";

const week = 7 * 86_400_000;
const scoreText = (value: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
const dateText = (value: string) =>
  `${new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(new Date(value))} МСК`;

export function courseActions(
  course: { title: string; works: readonly GradeWork[] },
  target: number,
  now: string,
  workId?: string,
) {
  const { works } = course;
  const current = exactWeightedTotal(works);
  const light = trafficLight(works, target, now);
  const pending = works.filter((work) => work.score === null);
  if (
    light.tone === "success" &&
    !pending.some((work) => Date.parse(work.dueAt) <= Date.parse(now) + week)
  )
    return null;

  const ordered = [...pending].sort(
    (a, b) =>
      Number(b.id === workId) - Number(a.id === workId) ||
      Number(b.isRequired && Date.parse(b.dueAt) < Date.parse(now)) -
        Number(a.isRequired && Date.parse(a.dueAt) < Date.parse(now)) ||
      a.dueAt.localeCompare(b.dueAt) ||
      a.id.localeCompare(b.id),
  );
  const baseline = whatIf(works, {}, target);
  const options = ordered.slice(0, 2).map((work) => {
    const minimum = baseline.remaining.find(
      (item) => item.id === work.id,
    )?.minimum;
    const score = Math.max(1, minimum ?? work.maxScore);
    const forecast = whatIf(works, { [work.id]: score }, target);
    const reachesTarget = exactWeightedTotal(
      works.map((item) => ({
        ...item,
        score: item.score ?? (item.id === work.id ? score : 0),
      })),
    ).atLeast(target);
    const overdue = Date.parse(work.dueAt) < Date.parse(now);
    return {
      workId: work.id,
      dueAt: work.dueAt,
      score,
      total: forecast.total,
      reachesTarget,
      title: overdue
        ? `Согласовать сдачу работы «${work.title}»`
        : `Сдать работу «${work.title}»`,
      description: overdue
        ? `Срок ${dateText(work.dueAt)} уже прошёл. Уточните возможность сдачи и согласуйте новую дату с преподавателем.`
        : `Можно запланировать сдачу до ${dateText(work.dueAt)}.`,
      effect: `Что это даст: ${score} из ${work.maxScore} → итог ${scoreText(forecast.total)} из 100 (${forecast.grade.label}); без этой работы — ${scoreText(baseline.total)}. Цель ≥ ${scoreText(target)} ${reachesTarget ? "достигнута в расчёте" : "пока не достигнута"}.`,
      notes: [
        ...(pending.length > 1
          ? ["Другие несданные работы учтены как 0 баллов."]
          : []),
        ...(work.isRequired
          ? ["Сдачу обязательной работы подтверждает преподаватель."]
          : []),
      ],
    };
  });
  // An alert can remain after all works are graded; do not invent a resit date.
  const steps = options.length
    ? options
    : [
        {
          workId: null,
          dueAt: null,
          score: null,
          total: baseline.total,
          reachesTarget: current.atLeast(target),
          title: "Уточнить возможность улучшить результат",
          description:
            "Все работы оценены. Можно обсудить с преподавателем доступные варианты и сроки.",
          effect: `Итог без новых баллов — ${scoreText(baseline.total)} из 100. Расчёт «Что если?» не меняет уже выставленные оценки.`,
          notes: [],
        },
      ];
  const work = ordered[0];
  const facts = [
    work
      ? `Работа: «${work.title}». Срок: ${dateText(work.dueAt)}.${Date.parse(work.dueAt) < Date.parse(now) ? " Срок уже прошёл." : ""}`
      : "Все работы по дисциплине оценены; несданных работ нет.",
    `Текущий итог без новых баллов: ${scoreText(baseline.total)} из 100. Моя цель: ≥ ${scoreText(target)}.`,
  ].join("\n");
  return {
    workId: work?.id ?? null,
    options: steps,
    appeal: {
      title: "Не успеваете?",
      description:
        "Можно уточнить в деканате, как согласовать дальнейшие шаги. Текст обращения можно изменить перед отправкой.",
      question: `Вопрос по дисциплине «${course.title}»\n\n${facts}\n\nПодскажите, как ${work ? "согласовать сдачу работы и уточнить сроки" : "улучшить результат и согласовать дальнейшие шаги"}?`,
    },
    assistantQuestion: `Что можно сделать по дисциплине «${course.title}»?\nДисциплина: «${course.title}».\n${facts}\nПомоги составить план действий и объясни варианты.`,
  };
}
