import {
  exactWeightedTotal,
  type GradeWork,
  workStatus,
} from "./grading-policy";
import { whatIf } from "./what-if";

export function trafficLight(
  works: readonly GradeWork[],
  target: number,
  now: string,
) {
  const forecast = whatIf(works, {}, target);
  const debts = works.filter(
    (work) => work.isRequired && workStatus(work, now) === "overdue",
  );
  if (debts.length > 0)
    return {
      tone: "danger" as const,
      label: "Есть долг",
      reason:
        "Просрочена обязательная работа. Баллов недостаточно для закрытия долга без её сдачи.",
      action:
        "Свяжитесь с преподавателем и согласуйте срок сдачи обязательной работы.",
    };
  const maximum = exactWeightedTotal(
    works.map((work) => ({ ...work, score: work.score ?? work.maxScore })),
  );
  if (!maximum.atLeast(55))
    return {
      tone: "danger" as const,
      label: "Нужен план действий",
      reason: "Даже максимум за оставшиеся работы не даст 55 баллов.",
      action: "Обсудите с преподавателем возможность пересдачи.",
    };
  if (exactWeightedTotal(works).atLeast(target))
    return {
      tone: "success" as const,
      label: "В норме",
      reason: "Уже набранных баллов достаточно для вашей цели.",
      action: works.some((work) => work.score === null)
        ? "Проверьте сроки оставшихся обязательных работ: цель по баллам не отменяет их сдачу."
        : "Все работы оценены. Проверьте даты сессии.",
    };
  return {
    tone: "warning" as const,
    label: "На грани",
    reason: forecast.targetReachable
      ? "Без новых баллов итог ниже вашей цели, но её ещё можно достичь."
      : "Цель недостижима за оставшиеся работы, но набрать 55 баллов ещё возможно.",
    action: forecast.targetReachable
      ? "Рассчитайте нужные баллы и запланируйте сдачу оставшихся работ."
      : "Обсудите с преподавателем, как улучшить результат.",
  };
}
