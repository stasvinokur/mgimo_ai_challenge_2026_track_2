import { expect, it } from "vitest";
import { courseActions } from "@/domain/grades/course-actions";
import type { GradeWork } from "@/domain/grades/grading-policy";
import { trafficLight } from "@/domain/grades/traffic-light";

const now = "2026-11-05T09:00:00Z";
function work(id: string, overrides: Partial<GradeWork> = {}): GradeWork {
  return {
    id,
    title: `Работа ${id}`,
    weight: 50,
    maxScore: 100,
    score: null,
    dueAt: "2026-11-07T21:30:00Z",
    isRequired: true,
    ...overrides,
  };
}
const plan = (works: GradeWork[], target = 70, workId?: string) =>
  courseActions({ title: "Основы маркетинга", works }, target, now, workId);

it("долг: срок в Москве, согласование новой даты, факты и независимый расчёт", () => {
  const works = [
    work("debt", { weight: 60, dueAt: "2026-11-02T21:30:00Z" }),
    work("done", { weight: 40, score: 72 }),
  ];
  const before = structuredClone(works);
  const result = plan(works);
  expect(result?.options).toHaveLength(1);
  expect(result?.options[0]).toMatchObject({
    workId: "debt",
    score: 69,
    total: 70.2,
    reachesTarget: true,
  });
  expect(result?.options[0]?.description).toContain(
    "3 ноября 2026 г. в 00:30 МСК",
  );
  expect(result?.options[0]?.description).toContain("согласуйте новую дату");
  expect(result?.options[0]?.effect).toContain("без этой работы — 28,8");
  expect(result?.appeal.question).toContain(
    "Текущий итог без новых баллов: 28,8 из 100",
  );
  expect(result?.appeal.question).toContain("Срок уже прошёл");
  expect(result?.appeal.question.split("\n")[0]).toBe(
    "Вопрос по дисциплине «Основы маркетинга»",
  );
  expect(result?.appeal.question.split("Основы маркетинга")).toHaveLength(2);
  expect(result?.options[0]?.effect).toBe(
    "Что это даст: 69 из 100 → итог 70,2 из 100 (хорошо); без этой работы — 28,8. Цель ≥ 70 достигнута в расчёте.",
  );
  expect(result?.options[0]?.notes).toEqual([
    "Сдачу обязательной работы подтверждает преподаватель.",
  ]);
  expect(result?.assistantQuestion).toContain("Работа: «Работа debt»");
  expect(result?.appeal.question.length).toBeLessThanOrEqual(2000);
  expect(works).toEqual(before);
});

it("под угрозой: максимум ниже 55 даёт честный эффект, без обещания достижения цели", () => {
  const works = [
    work("done", { weight: 90, score: 0 }),
    work("pending", { weight: 10 }),
  ];
  expect(trafficLight(works, 70, now).label).toBe("Нужен план действий");
  expect(plan(works)?.options[0]).toMatchObject({
    score: 100,
    total: 10,
    reachesTarget: false,
  });
  expect(plan(works)?.options[0]?.effect).toContain("пока не достигнута");
});

it("на грани: работа и срок с прогнозом до личной цели", () => {
  const works = [work("done", { score: 80 }), work("pending")];
  expect(trafficLight(works, 70, now).label).toBe("На грани");
  expect(plan(works)?.options[0]).toMatchObject({
    score: 60,
    total: 70,
    reachesTarget: true,
  });
  expect(plan(works)?.options[0]?.description).toContain(
    "8 ноября 2026 г. в 00:30 МСК",
  );
});

it("срок скоро даёт варианты даже при зелёном светофоре, граница 7 дней включена", () => {
  const works = [
    work("done", { weight: 90, score: 100 }),
    work("soon", { weight: 10, dueAt: "2026-11-12T09:00:00Z" }),
  ];
  expect(trafficLight(works, 86, now).tone).toBe("success");
  expect(plan(works, 86)?.workId).toBe("soon");
  const later = works.map((item) =>
    item.id === "soon" ? { ...item, dueAt: "2026-11-12T09:00:00.001Z" } : item,
  );
  expect(plan(later, 86)).toBeNull();
});

it("без алерта вариантов нет; при всех оценённых работах не придумывает работу или дату", () => {
  expect(plan([work("a", { score: 90 }), work("b", { score: 90 })])).toBeNull();
  const result = plan([work("a", { score: 10 }), work("b", { score: 10 })]);
  expect(result?.options).toHaveLength(1);
  expect(result?.options[0]).toMatchObject({
    workId: null,
    dueAt: null,
    total: 10,
  });
  expect(result?.appeal.question).toContain("несданных работ нет");
});

it("не больше трёх вариантов с обращением, выбранная работа первая, сценарии не складываются", () => {
  const works = [
    work("a", { weight: 30 }),
    work("b", { weight: 30 }),
    work("c", { weight: 40 }),
  ];
  const result = plan(works, 70, "c");
  expect(result?.options.map((option) => option.workId)).toEqual(["c", "a"]);
  expect(result?.options.map((option) => option.total)).toEqual([40, 30]);
  expect(result?.appeal.question).toContain("Работа: «Работа c»");
  expect(result?.options[0]?.notes).toContain(
    "Другие несданные работы учтены как 0 баллов.",
  );
});

it("у необязательной работы нет оговорки об обязательности, при одной несданной работе нет оговорки о других", () => {
  const result = plan([
    work("a", { score: 80 }),
    work("b", { isRequired: false }),
  ]);
  expect(result?.options[0]?.notes).toEqual([]);
  expect(result?.options[0]?.effect).not.toContain("Другие несданные работы");
});

it("граница TASK-12: 77/99/68 с весами 45/45/10 даёт ровно 86", () => {
  const result = plan(
    [
      work("a", { weight: 45, score: 77 }),
      work("b", { weight: 45, score: 99 }),
      work("c", { weight: 10 }),
    ],
    86,
  );
  expect(result?.options[0]).toMatchObject({
    score: 68,
    total: 86,
    reachesTarget: true,
  });
  expect(result?.options[0]?.effect).toContain("86 из 100 (отлично)");
});

it("перебор нескольких взвешенных слагаемых: балл минимален и решение совпадает с целочисленным эталоном", () => {
  let count = 0;
  for (const a of [0, 1, 2, 3])
    for (const b of [0, 1, 2])
      for (const target of [55, 70, 86]) {
        const works = [
          work("a", { weight: 30, maxScore: 3, score: a }),
          work("b", { weight: 25, maxScore: 2, score: b }),
          work("c", { weight: 45, maxScore: 6 }),
        ];
        const option = plan(works, target)?.options[0];
        if (!option || option.score === null) continue;
        const base = a * 60 + b * 75;
        const reference =
          Array.from({ length: 6 }, (_, i) => i + 1).find(
            (score) => base + score * 45 >= target * 6,
          ) ?? 6;
        expect(option.score).toBe(reference);
        expect(option.total).toBe((base + reference * 45) / 6);
        expect(option.reachesTarget).toBe(base + reference * 45 >= target * 6);
        count++;
      }
  expect(count).toBe(36);
});
