import { beforeEach, describe, expect, it } from "vitest";
import { CompleteOnboardingStep } from "@/application/onboarding/complete-step";
import { GetMyOnboarding } from "@/application/onboarding/get-onboarding";
import { HideOnboarding } from "@/application/onboarding/hide-onboarding";
import type {
  OnboardingFeatures,
  OnboardingRepository,
  OnboardingSnapshot,
} from "@/application/onboarding/ports";
import { parseOnboardingAction } from "@/application/onboarding/schemas";
import type { Actor } from "@/application/ports/actor";
import type { StoredStepCode } from "@/domain/onboarding/steps";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/domain/shared/errors";

const first = {
  kind: "student",
  userId: "first-user",
  studentId: "first-student",
  facultyId: "faculty",
} satisfies Actor;
const other = { ...first, userId: "other-user", studentId: "other-student" };
const at = "2026-11-05T12:00:00.000Z";
const clock = { now: () => new Date(at) };

function snapshot(course = 1): OnboardingSnapshot {
  return {
    course,
    completedCodes: [],
    automatic: {
      calendar: false,
      assistant: false,
      push: false,
      passkey: false,
    },
  };
}

class FakeOnboarding implements OnboardingRepository {
  readonly users = new Map<string, OnboardingSnapshot>([
    [first.userId, snapshot()],
    [other.userId, snapshot()],
  ]);
  readonly reads: string[] = [];
  readonly writes: { userId: string; codes: readonly string[]; at: string }[] =
    [];

  async findForUser(userId: string) {
    this.reads.push(userId);
    return this.users.get(userId) ?? null;
  }

  async completeForUser(
    userId: string,
    codes: readonly StoredStepCode[],
    completedAt: string,
  ) {
    this.writes.push({ userId, codes, at: completedAt });
    const state = this.users.get(userId);
    if (!state) throw new Error("В тесте нет профиля.");
    state.completedCodes = [...new Set([...state.completedCodes, ...codes])];
  }
}

let repository: FakeOnboarding;
function cases(features?: OnboardingFeatures) {
  const get = new GetMyOnboarding(repository, clock, features);
  return {
    get,
    complete: new CompleteOnboardingStep(repository, clock, get),
    hide: new HideOnboarding(repository, clock),
  };
}

beforeEach(() => {
  repository = new FakeOnboarding();
});

it("первокурсник получает пять шагов в заданном массивом порядке", async () => {
  const value = await cases().get.execute(first);
  expect(value?.steps).toEqual([
    { code: "schedule", completed: false, automatic: false },
    { code: "calendar", completed: false, automatic: true },
    { code: "install", completed: false, automatic: false },
    { code: "regulations", completed: false, automatic: false },
    { code: "assistant", completed: false, automatic: true },
  ]);
  expect(value).toMatchObject({ completed: 0, total: 5 });
  expect(Object.keys(value ?? {}).sort()).toEqual([
    "completed",
    "steps",
    "total",
  ]);
  for (const step of value?.steps ?? [])
    expect(Object.keys(step).sort()).toEqual([
      "automatic",
      "code",
      "completed",
    ]);
  expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  expect(repository.writes).toHaveLength(0);
});

it("четыре автоисточника сохраняют отметки один раз и переживают исчезновение источника", async () => {
  repository.users.set(first.userId, {
    ...snapshot(),
    automatic: { calendar: true, assistant: true, push: true, passkey: true },
  });
  const c = cases({ push: true, passkey: true });
  expect(await c.get.execute(first)).toMatchObject({ completed: 4, total: 7 });
  expect(repository.writes).toEqual([
    {
      userId: first.userId,
      codes: ["calendar", "assistant", "push", "passkey"],
      at,
    },
  ]);
  await c.get.execute(first);
  expect(repository.writes).toHaveLength(1);
  const saved = repository.users.get(first.userId);
  if (!saved) throw new Error("Нет тестового профиля.");
  saved.automatic = snapshot().automatic;
  const afterNewUseCase = await cases({
    push: true,
    passkey: true,
  }).get.execute(first);
  expect(afterNewUseCase).toMatchObject({ completed: 4, total: 7 });
  expect(repository.writes).toHaveLength(1);
});

it("недоступные push и passkey скрыты, но их автоотметки всё равно сохраняются", async () => {
  repository.users.set(first.userId, {
    ...snapshot(),
    automatic: { calendar: false, assistant: false, push: true, passkey: true },
  });
  expect(await cases().get.execute(first)).toMatchObject({
    completed: 0,
    total: 5,
  });
  expect(repository.users.get(first.userId)?.completedCodes).toEqual([
    "push",
    "passkey",
  ]);
  expect(
    (await cases({ push: true, passkey: false }).get.execute(first))?.steps.map(
      (step) => step.code,
    ),
  ).toEqual([
    "schedule",
    "calendar",
    "install",
    "regulations",
    "assistant",
    "push",
  ]);
});

it("ручные отметки идемпотентны, сохраняются и принадлежат только текущему пользователю", async () => {
  const c = cases();
  for (const stepCode of ["schedule", "install", "regulations"]) {
    await c.complete.execute(first, { stepCode });
    await c.complete.execute(first, { stepCode });
  }
  expect(await cases().get.execute(first)).toMatchObject({ completed: 3 });
  expect(await c.get.execute(other)).toMatchObject({ completed: 0 });
  expect(repository.users.get(first.userId)?.completedCodes).toEqual([
    "schedule",
    "install",
    "regulations",
  ]);
  expect(
    repository.writes.every((write) => write.userId === first.userId),
  ).toBe(true);
  expect(repository.writes.every((write) => write.at === at)).toBe(true);
});

it("скрытие переживает новый use case, не затрагивает другого пользователя и запрещает новые отметки", async () => {
  const c = cases();
  await c.complete.execute(first, { stepCode: "install" });
  expect(await c.hide.execute(first)).toBeNull();
  expect(await cases().get.execute(first)).toBeNull();
  expect(await c.hide.execute(first)).toBeNull();
  await expect(
    c.complete.execute(first, { stepCode: "schedule" }),
  ).rejects.toBeInstanceOf(NotFoundError);
  expect(repository.users.get(first.userId)?.completedCodes).toEqual([
    "install",
    "hidden",
  ]);
  expect(await c.get.execute(other)).toMatchObject({ completed: 0, total: 5 });
});

it.each([2, 3, 4, 5, 6])(
  "курс %i не получает онбординг и не может менять отметки",
  async (course) => {
    repository.users.set(first.userId, snapshot(course));
    const c = cases();
    expect(await c.get.execute(first)).toBeNull();
    await expect(
      c.complete.execute(first, { stepCode: "install" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(c.hide.execute(first)).rejects.toBeInstanceOf(NotFoundError);
    expect(repository.writes).toHaveLength(0);
  },
);

it("отсутствующий профиль неотличим от несуществующего", async () => {
  repository.users.delete(first.userId);
  const c = cases();
  await expect(c.get.execute(first)).rejects.toBeInstanceOf(NotFoundError);
  await expect(
    c.complete.execute(first, { stepCode: "install" }),
  ).rejects.toBeInstanceOf(NotFoundError);
  await expect(c.hide.execute(first)).rejects.toBeInstanceOf(NotFoundError);
});

describe.each([
  { kind: "staff", userId: "staff", staffId: "staff", facultyIds: [] },
  { kind: "teacher", userId: "teacher", teacherId: "teacher" },
] satisfies Actor[])("роль $kind", (actor) => {
  it("отклоняется во всех use cases до обращения к порту", async () => {
    const c = cases();
    await expect(c.get.execute(actor)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(c.complete.execute(actor, {})).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(c.hide.execute(actor)).rejects.toBeInstanceOf(ForbiddenError);
    expect(repository.reads).toHaveLength(0);
    expect(repository.writes).toHaveLength(0);
  });
});

it.each([
  null,
  {},
  { stepCode: "calendar" },
  { stepCode: "assistant" },
  { stepCode: "push" },
  { stepCode: "passkey" },
  { stepCode: "hidden" },
  { stepCode: "unknown" },
  { stepCode: "install", userId: other.userId },
  { stepCode: "install", studentId: other.studentId },
  { stepCode: "install", action: "hide" },
])(
  "ручное действие отвергает неподходящие или лишние поля: %j",
  async (input) => {
    await expect(cases().complete.execute(first, input)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(repository.reads).toHaveLength(0);
    expect(repository.writes).toHaveLength(0);
  },
);

it("вход HTTP-действия разрешает только ручной код или скрытие без id", () => {
  expect(parseOnboardingAction({ stepCode: "install" })).toEqual({
    stepCode: "install",
  });
  expect(parseOnboardingAction({ action: "hide" })).toEqual({ action: "hide" });
  for (const input of [
    { action: "hide", userId: other.userId },
    { action: "hide", studentId: other.studentId },
    { action: "hide", stepCode: "install" },
    { action: "unknown" },
  ])
    expect(() => parseOnboardingAction(input)).toThrow(ValidationError);
});
