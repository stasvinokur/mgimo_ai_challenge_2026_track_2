import { afterAll, expect, it } from "vitest";
import { CompleteOnboardingStep } from "@/application/onboarding/complete-step";
import { GetMyOnboarding } from "@/application/onboarding/get-onboarding";
import { HideOnboarding } from "@/application/onboarding/hide-onboarding";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresOnboardingRepository } from "@/infrastructure/db/repositories/onboarding/repository";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { openStudentTestData } from "./student-e2e-data";

const sql = createDatabase(1);
const repository = new PostgresOnboardingRepository(() => sql);
const ids = new UuidV7Generator();
const clock = { now: () => new Date("2026-11-05T12:00:00.000Z") };
afterAll(() => sql.end({ timeout: 1 }));

it("репозиторий читает автоисточники и сохранённые отметки только своего пользователя", async () => {
  const owner = await openStudentTestData("timur");
  const other = await openStudentTestData("timur");
  try {
    const automatic = async (student: typeof owner) => {
      await sql`insert into calendar_tokens (id, student_id, token_hash)
        values (${ids.next()}, ${student.actor.studentId}, ${ids.next().replaceAll("-", "").repeat(2)})`;
      await sql`insert into assistant_log (id, user_id, question, sources, tool_calls, outcome)
        values (${ids.next()}, ${student.actor.userId}, 'Как найти расписание?', '[]', '[]', 'answer')`;
      await sql`insert into push_subscriptions (id, user_id, endpoint, p256dh, auth)
        values (${ids.next()}, ${student.actor.userId}, ${`https://push.example.invalid/${student.actor.userId}`}, 'test-public-key', 'test-auth')`;
      await sql`insert into passkey_credentials (id, user_id, credential_id, public_key, device_name)
        values (${ids.next()}, ${student.actor.userId}, ${`test-${student.actor.userId}`}, 'test-public-key', 'Учебный телефон')`;
    };
    await automatic(other);
    await repository.completeForUser(
      other.actor.userId,
      ["regulations"],
      clock.now().toISOString(),
    );
    expect(await repository.findForUser(owner.actor.userId)).toEqual({
      course: 1,
      completedCodes: [],
      automatic: {
        calendar: false,
        assistant: false,
        push: false,
        passkey: false,
      },
    });
    await automatic(owner);
    const get = new GetMyOnboarding(repository, clock, {
      push: true,
      passkey: true,
    });
    expect(await get.execute(owner.actor)).toMatchObject({
      completed: 4,
      total: 7,
    });
    const marks = await sql<{ stepCode: string; at: Date }[]>`
      select step_code as "stepCode", completed_at as at from onboarding_steps
      where user_id = ${owner.actor.userId} order by step_code`;
    expect(marks.map((mark) => mark.stepCode)).toEqual([
      "assistant",
      "calendar",
      "passkey",
      "push",
    ]);
    expect(
      marks.every(
        (mark) => mark.at.toISOString() === clock.now().toISOString(),
      ),
    ).toBe(true);
    await sql`delete from calendar_tokens where student_id = ${owner.actor.studentId}`;
    await sql`delete from assistant_log where user_id = ${owner.actor.userId}`;
    await sql`delete from push_subscriptions where user_id = ${owner.actor.userId}`;
    await sql`delete from passkey_credentials where user_id = ${owner.actor.userId}`;
    expect(await get.execute(owner.actor)).toMatchObject({
      completed: 4,
      total: 7,
    });
    const complete = new CompleteOnboardingStep(repository, clock, get);
    await complete.execute(owner.actor, { stepCode: "install" });
    await new HideOnboarding(repository, clock).execute(owner.actor);
    expect(await get.execute(owner.actor)).toBeNull();
    const otherSnapshot = await repository.findForUser(other.actor.userId);
    expect(otherSnapshot?.completedCodes).toEqual(["regulations"]);
    expect(otherSnapshot?.automatic).toEqual({
      calendar: true,
      assistant: true,
      push: true,
      passkey: true,
    });
  } finally {
    await Promise.all([owner.close(), other.close()]);
  }
});

it("повторная отметка не меняет время и не влияет на другого пользователя", async () => {
  const owner = await openStudentTestData("timur");
  const other = await openStudentTestData("anna");
  try {
    await repository.completeForUser(
      owner.actor.userId,
      ["schedule"],
      "2026-11-05T12:00:00.000Z",
    );
    await repository.completeForUser(
      owner.actor.userId,
      ["schedule"],
      "2026-11-06T12:00:00.000Z",
    );
    const [mark] = await sql<{ at: Date }[]>`
      select completed_at as at from onboarding_steps
      where user_id = ${owner.actor.userId} and step_code = 'schedule'`;
    expect(mark?.at.toISOString()).toBe("2026-11-05T12:00:00.000Z");
    expect(
      (await repository.findForUser(other.actor.userId))?.completedCodes,
    ).toEqual([]);
    expect(
      await new GetMyOnboarding(repository, clock).execute(other.actor),
    ).toBeNull();
    expect(await repository.findForUser(ids.next())).toBeNull();
  } finally {
    await Promise.all([owner.close(), other.close()]);
  }
});
