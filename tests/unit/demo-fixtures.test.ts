import { readFileSync } from "node:fs";
import { validate, version } from "uuid";
import { describe, expect, it } from "vitest";
import {
  demoAccounts,
  identityFixtures,
} from "../../scripts/fixtures/identity";
import {
  addWorkDays,
  fixtureContext,
  moscowDate,
} from "../../scripts/fixtures/shared";
import { buildDemoFixtures } from "../../scripts/seed";
import { demoAccounts as applicationDemoAccounts } from "../../src/application/identity/demo-accounts";
import { Argon2PasswordHasher } from "../../src/infrastructure/auth/argon2-password-hasher";
import { UuidV7Generator } from "../../src/infrastructure/system/id-generator";
import { FakeClock } from "../fakes/clock";

function fixture(instant = "2026-11-04T09:00:00Z") {
  const clock = new FakeClock(instant);
  const ctx = fixtureContext(clock, new UuidV7Generator());
  return { clock, ctx, f: buildDemoFixtures(ctx) };
}

it("14 студентов, 12 без логина, UUID v7 и уникальные ключи демо", () => {
  const { f } = fixture();
  expect(f.students).toHaveLength(14);
  expect(f.students.filter((row) => row.userId === null)).toHaveLength(12);
  const keys: string[] = [];
  for (const rows of Object.values(f)) {
    for (const row of rows) {
      if ("id" in row) {
        expect(validate(row.id)).toBe(true);
        expect(version(row.id)).toBe(7);
      }
      if ("seedKey" in row && row.seedKey) keys.push(row.seedKey);
    }
  }
  expect(new Set(keys).size).toBe(keys.length);
  expect(f.students.every((row) => /^DEMO-\d{4}$/.test(row.recordBookNo))).toBe(
    true,
  );
});

describe.each(["2026-11-02", "2026-12-28", "2027-02-22"])(
  "Живые даты недели %s",
  (start) => {
    it.each([0, 1, 2, 3, 4, 5, 6])(
      "демо-сценарии в день со смещением %i",
      (offset) => {
        const date = new Date(`${start}T09:00:00Z`);
        date.setUTCDate(date.getUTCDate() + offset);
        const { f, ctx } = fixture(date.toISOString());
        const change = f.scheduleChanges[0];
        const slot = f.scheduleSlots.find((row) => row.id === change?.slotId);
        const weekday = date.getUTCDay();
        expect(change?.date).toBe(moscowDate(ctx.at(weekday === 0 ? 1 : 0)));
        expect(slot?.weekday).toBe(weekday === 0 ? 1 : weekday);
        expect(slot?.groupId).toBe(ctx.row("group:fmo").id);
        expect(change?.newStartsAt).toBe("13:00:00");
        expect(
          f.requests.filter(
            (row) => row.studentId === ctx.row("student:timur").id,
          ),
        ).toHaveLength(0);
        expect(
          f.requests
            .filter((row) => row.studentId === ctx.row("student:anna").id)
            .map((row) => row.status)
            .sort(),
        ).toEqual(["in_progress", "ready", "ready"]);
        expect(f.requests).toHaveLength(9);
        const open = f.requests.filter((row) => row.status !== "ready");
        expect(
          open.filter((row) => row.dueAt && row.dueAt < ctx.at(0)),
        ).toHaveLength(2);
        expect(
          open.filter(
            (row) =>
              row.dueAt?.getTime() === addWorkDays(ctx.at(0, 17), 1).getTime(),
          ),
        ).toHaveLength(2);
        for (const request of f.requests) {
          const type = f.requestTypes.find(
            (row) => row.code === request.typeCode,
          );
          expect(
            addWorkDays(request.submittedAt as Date, type?.slaWorkDays ?? 0),
          ).toEqual(request.dueAt);
          expect(request.submittedAt?.getTime()).toBeLessThan(
            ctx.now.getTime(),
          );
        }
        for (const key of [
          "assessment:imp:0:0",
          "assessment:imp:1:2",
          "assessment:fmo:0:2",
        ]) {
          const work = f.assessments.find(
            (row) => row.seedKey === `demo:${key}`,
          );
          expect(work?.dueAt).toEqual(
            ctx.at(
              key.endsWith(":0:0")
                ? -3
                : key.startsWith("assessment:fmo")
                  ? 3
                  : 2,
            ),
          );
        }
        expect(
          f.announcements.every(
            (row) => moscowDate(row.publishedAt) >= moscowDate(ctx.at(-1)),
          ),
        ).toBe(true);
      },
    );
  },
);

it("московская полночь и Clock определяют день независимо от UTC и системных часов", () => {
  const { ctx } = fixture("2026-11-08T21:01:00Z");
  expect(ctx.today).toBe("2026-11-09");
  expect(moscowDate(ctx.studyDay)).toBe("2026-11-09");
  expect(addWorkDays(new Date("2026-11-06T14:00:00Z"), 1)).toEqual(
    new Date("2026-11-09T14:00:00Z"),
  );
});

it("две группы имеют неделю пн–сб, 6 дисциплин с весами 100 и сессию", () => {
  const { f } = fixture();
  for (const group of f.groups) {
    const slots = f.scheduleSlots.filter((row) => row.groupId === group.id);
    expect(slots).toHaveLength(12);
    expect([...new Set(slots.map((row) => row.weekday))]).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    const works = f.assessments.filter((row) => row.groupId === group.id);
    expect(new Set(works.map((row) => row.courseId)).size).toBe(6);
    for (const course of new Set(works.map((row) => row.courseId))) {
      expect(
        works
          .filter((row) => row.courseId === course)
          .reduce((sum, row) => sum + row.weight, 0),
      ).toBe(100);
    }
    expect(
      f.sessionsExams.filter((row) => row.groupId === group.id),
    ).toHaveLength(6);
    const student = f.students.find(
      (row) => row.groupId === group.id && row.userId,
    );
    expect(f.notifications.some((row) => row.userId === student?.userId)).toBe(
      true,
    );
    expect(f.announcements.some((row) => row.audienceRef === group.id)).toBe(
      true,
    );
  }
  for (const slot of f.scheduleSlots) {
    expect(f.rooms.some((row) => row.id === slot.roomId)).toBe(true);
    expect(f.teachers.some((row) => row.id === slot.teacherId)).toBe(true);
  }
});

it("стипендия Анны зависит от оставшейся работы, а у Тимура есть обязательный долг", () => {
  const { f, ctx } = fixture();
  const anna = ctx.row("student:anna").id;
  for (const courseId of new Set(
    f.assessments
      .filter((row) => row.groupId === ctx.row("group:fmo").id)
      .map((row) => row.courseId),
  )) {
    let earned = 0;
    let completedWeight = 0;
    let remainingWeight = 0;
    for (const work of f.assessments.filter(
      (row) => row.courseId === courseId,
    )) {
      const score = f.scores.find(
        (row) => row.studentId === anna && row.assessmentId === work.id,
      )?.score;
      if (score == null) remainingWeight += work.weight;
      else {
        earned += (score / work.maxScore) * work.weight;
        completedWeight += work.weight;
      }
    }
    expect((earned / completedWeight) * 100).toBeGreaterThanOrEqual(86);
    if (remainingWeight > 0) {
      expect(earned).toBeCloseTo(78.3);
      expect(Math.ceil(((86 - earned) / remainingWeight) * 100)).toBe(77);
      expect(earned + 0.77 * remainingWeight).toBeCloseTo(86);
    }
  }
  const debt = f.assessments.find(
    (row) => row.seedKey === "demo:assessment:imp:0:0",
  );
  expect(debt?.isRequired).toBe(true);
  expect(debt?.dueAt.getTime()).toBeLessThan(ctx.now.getTime());
  expect(
    f.scores.find(
      (row) =>
        row.assessmentId === debt?.id &&
        row.studentId === ctx.row("student:timur").id,
    )?.score,
  ).toBeNull();
  expect(100 - (debt?.weight ?? 0)).toBeLessThan(55);
});

it("каталог полей соответствует payload, а истории заканчиваются текущим статусом", () => {
  const { f } = fixture();
  expect(f.requestTypes).toHaveLength(9);
  for (const request of f.requests) {
    const type = f.requestTypes.find((row) => row.code === request.typeCode);
    expect(type?.slaWorkDays).toBeGreaterThan(0);
    const schema = type?.fieldsSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(
      Object.keys(request.payload).every((key) => key in schema.properties),
    ).toBe(true);
    expect(schema.required.every((key) => key in request.payload)).toBe(true);
    const events = f.requestEvents.filter(
      (row) => row.requestId === request.id,
    );
    expect(events.at(-1)?.toStatus).toBe(request.status);
    expect(
      events.every(
        (row, i) =>
          row.fromStatus === (i === 0 ? "draft" : events[i - 1]?.toStatus),
      ),
    ).toBe(true);
  }
  expect(f.certificates[0]?.verifyCode).toMatch(/^[A-Z2-7]{26}$/);
});

it("бумажная справка, окна выдачи и история оценки связаны с владельцами", () => {
  const { f, ctx } = fixture();
  const type = f.requestTypes.find((row) => row.code === "enrollment_paper");
  expect(type).toMatchObject({
    title: "Бумажная справка об обучении с печатью",
    delivery: "pickup",
    isCertificate: true,
    fieldsSchema: { fieldOrder: ["destination"] },
  });
  expect(
    f.requests.find((row) => row.typeCode === "enrollment_paper"),
  ).toMatchObject({
    seedKey: "demo:request:8",
    studentId: ctx.row("student:anna").id,
    status: "ready",
  });
  expect(f.pickupWindows).toHaveLength(2);
  expect(new Set(f.pickupWindows.map((row) => row.facultyId))).toEqual(
    new Set(f.faculties.map((row) => row.id)),
  );
  expect(f.scoreEvents).toHaveLength(1);
  const event = f.scoreEvents[0];
  if (!event) throw new Error("Нет демо-истории оценки.");
  expect(event).toMatchObject({
    studentId: ctx.row("student:anna").id,
    studentUserId: ctx.row("user:anna").id,
    previousScore: 85,
    newScore: 90,
    changedByUserId: ctx.row("user:oleg").id,
    reason: "appeal_review",
  });
  const assessment = f.assessments.find(
    (row) => row.id === event?.assessmentId,
  );
  const teacher = f.teachers.find(
    (row) => row.userId === event?.changedByUserId,
  );
  expect(
    f.scheduleSlots.some(
      (row) =>
        row.groupId === assessment?.groupId &&
        row.courseId === assessment?.courseId &&
        row.teacherId === teacher?.id,
    ),
  ).toBe(true);
  expect(
    f.scores.find(
      (row) =>
        row.studentId === event?.studentId &&
        row.assessmentId === event.assessmentId,
    ),
  ).toMatchObject({ score: event?.newScore, gradedAt: event?.createdAt });
});

it("README перечисляет демо-аккаунты без паролей, хэши соответствуют паролям по умолчанию", async () => {
  expect(demoAccounts).toBe(applicationDemoAccounts);
  expect(demoAccounts.map((account) => account.displayName)).toEqual([
    "Анна",
    "Тимур",
    "Марина",
    "Олег",
  ]);
  const { ctx } = fixture();
  const hasher = new Argon2PasswordHasher();
  const users = await identityFixtures(ctx, hasher);
  const readme = readFileSync(
    new URL("../../README.md", import.meta.url),
    "utf8",
  );
  for (const account of demoAccounts) {
    const user = users.find((row) => row.login === account.login);
    expect(readme).toContain(`| \`${account.login}\` |`);
    // Public stand passwords come from a server secret (D-52): README does not publish the defaults.
    expect(readme).not.toContain(account.password);
    expect(
      await hasher.verify(user?.passwordHash ?? "", account.password),
    ).toBe(true);
    expect(JSON.stringify(users)).not.toContain(account.password);
  }
});
