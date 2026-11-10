import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Clock } from "../src/application/ports/clock";
import { Argon2PasswordHasher } from "../src/infrastructure/auth/argon2-password-hasher";
import { getEnv } from "../src/infrastructure/config/env";
import { createDatabase } from "../src/infrastructure/db/client";
import * as s from "../src/infrastructure/db/schema";
import { SystemClock } from "../src/infrastructure/system/clock";
import { UuidV7Generator } from "../src/infrastructure/system/id-generator";
import { assistantFixtures, syncRegulations } from "./fixtures/assistant";
import { attendanceFixtures } from "./fixtures/attendance";
import { certificateFixtures } from "./fixtures/certificates";
import { gradeFixtures } from "./fixtures/grades";
import { identityFixtures } from "./fixtures/identity";
import { notificationFixtures } from "./fixtures/notifications";
import { pickupFixtures } from "./fixtures/pickup";
import { requestFixtures } from "./fixtures/requests";
import { scheduleFixtures } from "./fixtures/schedule";
import { type FixtureContext, fixtureContext } from "./fixtures/shared";
import { studentFixtures } from "./fixtures/student";

type Database = ReturnType<typeof createDatabase>;
type DemoTransaction = Pick<
  PostgresJsDatabase,
  "select" | "insert" | "update" | "delete" | "execute"
>;

export function buildDemoFixtures(ctx: FixtureContext) {
  const student = studentFixtures(ctx);
  const requests = requestFixtures(ctx);
  const ready = requests.requestEvents.find((row) => row.toStatus === "ready");
  if (!ready?.at) throw new Error("Нет события готовности демо-справки.");
  return {
    ...student,
    ...scheduleFixtures(ctx),
    ...attendanceFixtures(ctx),
    ...gradeFixtures(ctx, student.students),
    ...pickupFixtures(ctx),
    ...requests,
    ...notificationFixtures(ctx),
    certificates: certificateFixtures(ctx, ready.at),
    regulationChunks: assistantFixtures(ctx),
  };
}

async function withDemoTransaction(
  database: Database,
  clock: Clock,
  action: (tx: DemoTransaction, ctx: FixtureContext) => Promise<void>,
) {
  await drizzle(database).transaction(async (tx) => {
    // Serializes seed/refresh without locking unrelated application writes.
    await tx.execute("select pg_advisory_xact_lock(8082026)");
    const existing = new Map<string, string>();
    for (const table of [
      s.users,
      s.faculties,
      s.programs,
      s.groups,
      s.students,
      s.staff,
      s.teachers,
      s.attendanceRecords,
      s.activityPoints,
      s.rooms,
      s.courses,
      s.scheduleSlots,
      s.scheduleChanges,
      s.assessments,
      s.scores,
      s.scoreEvents,
      s.sessionsExams,
      s.requests,
      s.requestEvents,
      s.notifications,
      s.announcements,
      s.certificates,
      s.pickupWindows,
      s.regulationChunks,
    ]) {
      const rows = await tx
        .select({ id: table.id, seedKey: table.seedKey })
        .from(table)
        .where(isNotNull(table.seedKey));
      for (const row of rows) {
        if (row.seedKey) existing.set(row.seedKey, row.id);
      }
    }
    await action(tx, fixtureContext(clock, new UuidV7Generator(), existing));
  });
}

async function refreshDates(
  tx: DemoTransaction,
  fixtures: ReturnType<typeof buildDemoFixtures>,
  refreshMutableDates = true,
  attendanceRecovery?: { now: Date; force: boolean },
) {
  if (attendanceRecovery) {
    await restoreDemoAttendance(tx, fixtures, attendanceRecovery);
  } else {
    // Replace only fixture history as a set: shifting weeks can overlap old dates.
    await tx.delete(s.attendanceRecords).where(
      and(
        eq(s.attendanceRecords.source, "demo"),
        inArray(
          s.attendanceRecords.seedKey,
          fixtures.attendanceRecords.map((row) => row.seedKey as string),
        ),
      ),
    );
    await tx
      .insert(s.attendanceRecords)
      .values(fixtures.attendanceRecords)
      .onConflictDoNothing();
  }
  await tx
    .insert(s.activityPoints)
    .values(fixtures.activityPoints)
    .onConflictDoNothing();
  for (const row of fixtures.activityPoints) {
    await tx
      .update(s.activityPoints)
      .set({ createdAt: row.createdAt })
      .where(eq(s.activityPoints.seedKey, row.seedKey as string));
  }
  for (const row of fixtures.scheduleChanges) {
    await tx
      .update(s.scheduleChanges)
      .set({
        slotId: row.slotId,
        date: row.date,
        newDate: row.newDate,
        createdAt: row.createdAt,
      })
      .where(eq(s.scheduleChanges.seedKey, row.seedKey as string));
  }
  for (const row of fixtures.assessments) {
    await tx
      .update(s.assessments)
      .set({ dueAt: row.dueAt })
      .where(eq(s.assessments.seedKey, row.seedKey as string));
  }
  if (refreshMutableDates)
    for (const row of fixtures.scores) {
      if (row.gradedAt)
        await tx
          .update(s.scores)
          .set({ gradedAt: row.gradedAt })
          .where(
            and(
              eq(s.scores.seedKey, row.seedKey as string),
              isNotNull(s.scores.score),
            ),
          );
    }
  for (const row of fixtures.sessionsExams) {
    await tx
      .update(s.sessionsExams)
      .set({ at: row.at })
      .where(eq(s.sessionsExams.seedKey, row.seedKey as string));
  }
  for (const row of fixtures.scoreEvents) {
    await tx
      .update(s.scoreEvents)
      .set({ createdAt: row.createdAt })
      .where(eq(s.scoreEvents.seedKey, row.seedKey as string));
  }
  if (refreshMutableDates) {
    for (const row of fixtures.requests) {
      await tx
        .update(s.requests)
        .set({
          submittedAt: row.submittedAt,
          dueAt: row.dueAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })
        .where(eq(s.requests.seedKey, row.seedKey as string));
    }
    for (const row of fixtures.requestEvents) {
      await tx
        .update(s.requestEvents)
        .set({ at: row.at })
        .where(eq(s.requestEvents.seedKey, row.seedKey as string));
    }
    for (const row of fixtures.certificates) {
      await tx
        .update(s.certificates)
        .set({ issuedAt: row.issuedAt })
        .where(eq(s.certificates.seedKey, row.seedKey as string));
    }
  }
  for (const row of fixtures.notifications) {
    await tx
      .update(s.notifications)
      .set({ createdAt: row.createdAt, body: row.body })
      .where(eq(s.notifications.seedKey, row.seedKey as string));
  }
  for (const row of fixtures.announcements) {
    await tx
      .update(s.announcements)
      .set({ publishedAt: row.publishedAt })
      .where(eq(s.announcements.seedKey, row.seedKey as string));
  }
}

export async function seedDemo(
  database: Database,
  clock: Clock = new SystemClock(),
) {
  const passwords = getEnv("DEMO_ACCOUNT_PASSWORDS");
  const rotatedUserIds: string[] = [];
  let longestVerificationMs = 0;
  await withDemoTransaction(database, clock, async (tx, ctx) => {
    const f = buildDemoFixtures(ctx);
    const hasher = new Argon2PasswordHasher();
    const users = await identityFixtures(ctx, hasher, passwords);
    await tx
      .insert(s.users)
      .values(users)
      .onConflictDoNothing({ target: s.users.seedKey });
    if (passwords) {
      for (const user of users) {
        const [existing] = await tx
          .select({ id: s.users.id, passwordHash: s.users.passwordHash })
          .from(s.users)
          .where(eq(s.users.seedKey, user.seedKey as string))
          .for("update");
        const password = passwords[user.login as keyof typeof passwords];
        if (!existing) continue;
        const started = performance.now();
        const matches = await hasher.verify(existing.passwordHash, password);
        longestVerificationMs = Math.max(
          longestVerificationMs,
          performance.now() - started,
        );
        if (matches) continue;
        await tx
          .update(s.users)
          .set({ passwordHash: user.passwordHash })
          .where(eq(s.users.id, existing.id));
        await tx.delete(s.sessions).where(eq(s.sessions.userId, existing.id));
        await tx
          .delete(s.passkeyCredentials)
          .where(eq(s.passkeyCredentials.userId, existing.id));
        await tx
          .delete(s.webauthnChallenges)
          .where(eq(s.webauthnChallenges.userId, existing.id));
        await tx
          .delete(s.pushSubscriptions)
          .where(eq(s.pushSubscriptions.userId, existing.id));
        await tx
          .delete(s.calendarTokens)
          .where(
            inArray(
              s.calendarTokens.studentId,
              tx
                .select({ id: s.students.id })
                .from(s.students)
                .where(eq(s.students.userId, existing.id)),
            ),
          );
        rotatedUserIds.push(existing.id);
      }
    }
    await tx
      .insert(s.faculties)
      .values(f.faculties)
      .onConflictDoNothing({ target: s.faculties.seedKey });
    await tx
      .insert(s.programs)
      .values(f.programs)
      .onConflictDoNothing({ target: s.programs.seedKey });
    await tx
      .insert(s.groups)
      .values(f.groups)
      .onConflictDoNothing({ target: s.groups.seedKey });
    await tx
      .insert(s.students)
      .values(f.students)
      .onConflictDoNothing({ target: s.students.seedKey });
    await tx
      .insert(s.staff)
      .values(f.staff)
      .onConflictDoNothing({ target: s.staff.seedKey });
    await tx
      .insert(s.staffFaculties)
      .values(f.staffFaculties)
      .onConflictDoNothing();
    await tx
      .insert(s.teachers)
      .values(f.teachers)
      .onConflictDoNothing({ target: s.teachers.seedKey });
    await tx
      .update(s.teachers)
      .set({ userId: ctx.row("user:oleg").id })
      .where(eq(s.teachers.seedKey, "demo:teacher:3"));
    await tx
      .insert(s.rooms)
      .values(f.rooms)
      .onConflictDoNothing({ target: s.rooms.seedKey });
    await tx
      .insert(s.courses)
      .values(f.courses)
      .onConflictDoNothing({ target: s.courses.seedKey });
    await tx
      .insert(s.scheduleSlots)
      .values(f.scheduleSlots)
      .onConflictDoNothing({ target: s.scheduleSlots.seedKey });
    await tx
      .insert(s.scheduleChanges)
      .values(f.scheduleChanges)
      .onConflictDoNothing({ target: s.scheduleChanges.seedKey });
    await tx
      .insert(s.assessments)
      .values(f.assessments)
      .onConflictDoNothing({ target: s.assessments.seedKey });
    await tx
      .insert(s.scores)
      .values(f.scores)
      .onConflictDoNothing({ target: s.scores.seedKey });
    await tx
      .insert(s.scoreEvents)
      .values(f.scoreEvents)
      .onConflictDoNothing({ target: s.scoreEvents.seedKey });
    await tx
      .insert(s.sessionsExams)
      .values(f.sessionsExams)
      .onConflictDoNothing({ target: s.sessionsExams.seedKey });
    await tx
      .insert(s.requestTypes)
      .values(f.requestTypes)
      .onConflictDoNothing({ target: s.requestTypes.seedKey });
    await tx
      .insert(s.requests)
      .values(f.requests)
      .onConflictDoNothing({ target: s.requests.seedKey });
    await tx
      .insert(s.pickupWindows)
      .values(f.pickupWindows)
      .onConflictDoNothing({ target: s.pickupWindows.seedKey });
    await tx
      .insert(s.requestEvents)
      .values(f.requestEvents)
      .onConflictDoNothing({ target: s.requestEvents.seedKey });
    await tx
      .insert(s.notifications)
      .values(f.notifications)
      .onConflictDoNothing({ target: s.notifications.seedKey });
    await tx
      .insert(s.announcements)
      .values(f.announcements)
      .onConflictDoNothing({ target: s.announcements.seedKey });
    await tx
      .insert(s.certificates)
      .values(f.certificates)
      .onConflictDoNothing({ target: s.certificates.seedKey });
    await syncRegulations(tx, f.regulationChunks);
    await refreshDates(tx, f);
  });
  if (rotatedUserIds.length) {
    // Drain logins that verified the old hash while their session insert waited for commit.
    await setTimeout(Math.max(1_000, Math.ceil(longestVerificationMs * 2)));
    await drizzle(database)
      .delete(s.sessions)
      .where(inArray(s.sessions.userId, rotatedUserIds));
  }
}

export async function pruneDemoIdentity(
  tx: Pick<DemoTransaction, "select" | "delete">,
  now: Date,
) {
  const { sql } = await import("drizzle-orm");
  const identityCutoff = new Date(
    now.getTime() - 24 * 60 * 60 * 1000,
  ).toISOString();
  for (const table of [s.passkeyCredentials, s.pushSubscriptions]) {
    await tx
      .delete(table)
      .where(
        and(
          inArray(
            table.userId,
            tx
              .select({ id: s.users.id })
              .from(s.users)
              .where(isNotNull(s.users.seedKey)),
          ),
          sql`${table.createdAt} < ${identityCutoff}::timestamptz`,
        ),
      );
  }
}

const demoRecoveryDelayMs = 60 * 60 * 1000;

async function restoreDemoAttendance(
  tx: DemoTransaction,
  fixtures: ReturnType<typeof buildDemoFixtures>,
  { now, force }: { now: Date; force: boolean },
) {
  const baseline = new Map(
    fixtures.attendanceRecords.map((row) => [row.seedKey, row]),
  );
  const existing = await tx
    .select()
    .from(s.attendanceRecords)
    .where(
      inArray(
        s.attendanceRecords.seedKey,
        fixtures.attendanceRecords.map((row) => row.seedKey as string),
      ),
    )
    .orderBy(s.attendanceRecords.id)
    .for("update");
  const cutoff = now.getTime() - demoRecoveryDelayMs;
  const protectedKeys = new Set(
    existing.flatMap((row) => {
      const original = baseline.get(row.seedKey);
      if (!original || force || row.markedAt.getTime() < cutoff) return [];
      const changed =
        row.source !== original.source ||
        row.status !== original.status ||
        row.sourceKey !== original.sourceKey ||
        row.reason !== (original.reason ?? null);
      return changed ? [row.seedKey] : [];
    }),
  );
  const restored = fixtures.attendanceRecords.filter(
    (row) => !protectedKeys.has(row.seedKey as string),
  );
  if (!restored.length) return;
  // Replacing the eligible set preserves UUIDs while allowing overlapping shifted dates.
  await tx.delete(s.attendanceRecords).where(
    inArray(
      s.attendanceRecords.seedKey,
      restored.map((row) => row.seedKey as string),
    ),
  );
  await tx.insert(s.attendanceRecords).values(restored).onConflictDoNothing();
}

function demoStaffUserIds(tx: DemoTransaction) {
  return tx
    .select({ id: s.users.id })
    .from(s.users)
    .where(and(isNotNull(s.users.seedKey), eq(s.users.role, "staff")));
}

function demoStudentIds(tx: DemoTransaction) {
  return tx
    .select({ id: s.students.id })
    .from(s.students)
    .where(
      or(
        isNotNull(s.students.seedKey),
        inArray(
          s.students.userId,
          tx
            .select({ id: s.users.id })
            .from(s.users)
            .where(isNotNull(s.users.seedKey)),
        ),
      ),
    );
}

export async function pruneDemoActivity(
  tx: DemoTransaction,
  now: Date,
  force = false,
) {
  const cutoff = new Date(now.getTime() - demoRecoveryDelayMs).toISOString();
  const demoUsers = tx
    .select({ id: s.users.id })
    .from(s.users)
    .where(isNotNull(s.users.seedKey));
  await tx
    .delete(s.notifications)
    .where(
      and(
        inArray(s.notifications.userId, demoUsers),
        isNull(s.notifications.seedKey),
        force
          ? undefined
          : sql`${s.notifications.createdAt} < ${cutoff}::timestamptz`,
      ),
    );
  await tx
    .delete(s.assistantLog)
    .where(
      and(
        inArray(s.assistantLog.userId, demoUsers),
        force ? undefined : sql`${s.assistantLog.at} < ${cutoff}::timestamptz`,
      ),
    );
  await tx
    .delete(s.attendanceRecords)
    .where(
      and(
        inArray(s.attendanceRecords.studentId, demoStudentIds(tx)),
        isNull(s.attendanceRecords.seedKey),
        force
          ? undefined
          : sql`${s.attendanceRecords.markedAt} < ${cutoff}::timestamptz`,
      ),
    );
  await tx
    .delete(s.activityPoints)
    .where(
      and(
        inArray(s.activityPoints.studentId, demoStudentIds(tx)),
        isNull(s.activityPoints.seedKey),
        force
          ? undefined
          : sql`${s.activityPoints.createdAt} < ${cutoff}::timestamptz`,
      ),
    );
}

async function refreshDemoRequests(
  tx: DemoTransaction,
  fixtures: ReturnType<typeof buildDemoFixtures>,
  now: Date,
  force: boolean,
) {
  const cutoff = new Date(now.getTime() - demoRecoveryDelayMs);
  // Request writers take this lock before bookings and the submission owner lock.
  const requests = await tx
    .select({ id: s.requests.id, seedKey: s.requests.seedKey })
    .from(s.requests)
    .where(inArray(s.requests.studentId, demoStudentIds(tx)))
    .orderBy(s.requests.id)
    .for("update");
  if (!requests.length) return;
  // Keep outer qualification: Drizzle strips Column prefixes in this selection.
  const latestChanges = await tx
    .select({
      id: s.requests.id,
      latest: sql<Date>`greatest(${s.requests.createdAt}, ${s.requests.updatedAt},
        (select max(at) from request_events where request_id = requests.id),
        (select max(greatest(issued_at, revoked_at)) from certificates where request_id = requests.id),
        (select max(created_at) from pickup_bookings where request_id = requests.id),
        (select max(at) from staff_audit_log where request_id = requests.id))`,
    })
    .from(s.requests)
    .where(
      inArray(
        s.requests.id,
        requests.map((row) => row.id),
      ),
    );
  const stale = new Set(
    latestChanges
      .filter((row) => force || row.latest.getTime() < cutoff.getTime())
      .map((row) => row.id),
  );
  const candidates = requests
    .filter((row) => !row.seedKey && stale.has(row.id))
    .map((row) => row.id);
  const protectedAudits = candidates.length
    ? await tx
        .select({ requestId: s.staffAuditLog.requestId })
        .from(s.staffAuditLog)
        .where(
          and(
            inArray(s.staffAuditLog.requestId, candidates),
            notInArray(s.staffAuditLog.staffUserId, demoStaffUserIds(tx)),
          ),
        )
    : [];
  const protectedRequests = new Set(
    protectedAudits.map((row) => row.requestId),
  );
  // The non-null audit FK requires retaining its parent to preserve ordinary staff history.
  const removed = candidates.filter((id) => !protectedRequests.has(id));
  if (removed.length) {
    await tx
      .delete(s.staffAuditLog)
      .where(
        and(
          inArray(s.staffAuditLog.requestId, removed),
          inArray(s.staffAuditLog.staffUserId, demoStaffUserIds(tx)),
        ),
      );
    await tx
      .delete(s.certificates)
      .where(inArray(s.certificates.requestId, removed));
    // Events and bookings cascade with their request.
    await tx.delete(s.requests).where(inArray(s.requests.id, removed));
  }
  for (const row of fixtures.requests) {
    if (!stale.has(row.id)) continue;
    // A service restore replaces the baseline atomically; it is not a transition.
    await tx.update(s.requests).set(row).where(eq(s.requests.id, row.id));
    await tx
      .delete(s.requestEvents)
      .where(
        and(
          eq(s.requestEvents.requestId, row.id),
          isNull(s.requestEvents.seedKey),
        ),
      );
    for (const event of fixtures.requestEvents.filter(
      (event) => event.requestId === row.id,
    ))
      await tx
        .insert(s.requestEvents)
        .values(event)
        .onConflictDoUpdate({ target: s.requestEvents.id, set: event });
    await tx
      .delete(s.certificates)
      .where(
        and(
          eq(s.certificates.requestId, row.id),
          isNull(s.certificates.seedKey),
        ),
      );
    for (const certificate of fixtures.certificates.filter(
      (certificate) => certificate.requestId === row.id,
    )) {
      const { verifyCode: _verifyCode, ...restored } = certificate;
      // Keep public verification links stable across hourly refreshes.
      await tx
        .insert(s.certificates)
        .values(certificate)
        .onConflictDoUpdate({
          target: s.certificates.id,
          set: { ...restored, revokedAt: null },
        });
    }
    await tx
      .delete(s.pickupBookings)
      .where(eq(s.pickupBookings.requestId, row.id));
    await tx
      .delete(s.staffAuditLog)
      .where(
        and(
          eq(s.staffAuditLog.requestId, row.id),
          inArray(s.staffAuditLog.staffUserId, demoStaffUserIds(tx)),
        ),
      );
  }
}

export async function refreshDemo(
  database: Database,
  clock: Clock = new SystemClock(),
  options: { force?: boolean } = {},
) {
  const force = options.force ?? process.env.DEMO_REFRESH_FORCE === "1";
  await withDemoTransaction(database, clock, async (tx, ctx) => {
    const fixtures = buildDemoFixtures(ctx);
    await pruneDemoIdentity(tx, ctx.now);
    await refreshDemoRequests(tx, fixtures, ctx.now, force);
    const demoStudents = await tx
      .select({
        id: s.students.id,
        userId: s.students.userId,
        groupId: s.students.groupId,
      })
      .from(s.students)
      .where(
        inArray(
          s.students.seedKey,
          fixtures.students.map((row) => row.seedKey as string),
        ),
      );
    const studentIds = demoStudents.map((row) => row.id);
    const groupIds = [...new Set(demoStudents.map((row) => row.groupId))];
    if (studentIds.length) {
      // Match grade writes' slot-before-student order and block new slot FKs.
      await tx
        .select({ id: s.groups.id })
        .from(s.groups)
        .where(inArray(s.groups.id, groupIds))
        .orderBy(s.groups.id)
        .for("update");
      await tx
        .select({ id: s.scheduleSlots.id })
        .from(s.scheduleSlots)
        .where(inArray(s.scheduleSlots.groupId, groupIds))
        .orderBy(s.scheduleSlots.id)
        .for("update");
      await tx
        .select({ id: s.students.id })
        .from(s.students)
        .where(inArray(s.students.id, studentIds))
        .orderBy(s.students.id)
        .for("share");
    }
    const cutoff = new Date(
      ctx.now.getTime() - demoRecoveryDelayMs,
    ).toISOString();
    for (const row of fixtures.scores) {
      if (!studentIds.includes(row.studentId)) continue;
      await tx
        .update(s.scores)
        .set({ score: row.score ?? null, gradedAt: row.gradedAt ?? null })
        .where(
          and(
            eq(s.scores.seedKey, row.seedKey as string),
            eq(s.scores.studentId, row.studentId),
            force
              ? undefined
              : sql`coalesce(greatest(${s.scores.gradedAt},
                  (select max(created_at) from score_events
                    where student_id = ${row.studentId} and assessment_id = ${row.assessmentId})),
                  '-infinity'::timestamptz) < ${cutoff}::timestamptz`,
          ),
        );
    }
    for (const row of fixtures.scoreEvents) {
      await tx
        .update(s.scoreEvents)
        .set({ reason: row.reason ?? null })
        .where(eq(s.scoreEvents.seedKey, row.seedKey as string));
    }
    if (studentIds.length)
      await tx
        .delete(s.scoreEvents)
        .where(
          and(
            inArray(s.scoreEvents.studentId, studentIds),
            sql`${s.scoreEvents.seedKey} is null`,
            force
              ? undefined
              : sql`${s.scoreEvents.createdAt} < ${cutoff}::timestamptz`,
          ),
        );
    const userIds = demoStudents.flatMap((row) =>
      row.userId ? [row.userId] : [],
    );
    if (userIds.length)
      await tx
        .delete(s.notifications)
        .where(
          and(
            inArray(s.notifications.userId, userIds),
            eq(s.notifications.kind, "change"),
            sql`${s.notifications.seedKey} is null`,
            sql`${s.notifications.title} like 'Новая оценка: %'`,
            sql`${s.notifications.link} ~ '^/grades/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
            force
              ? undefined
              : sql`${s.notifications.createdAt} < ${cutoff}::timestamptz`,
          ),
        );
    await pruneDemoActivity(tx, ctx.now, force);
    await refreshDates(tx, fixtures, false, { now: ctx.now, force });
  });
}

async function main() {
  const sql = createDatabase(1);
  try {
    await seedDemo(sql);
    console.info(
      "Демо-данные подготовлены. Пользовательские записи сохранены.",
    );
  } finally {
    await sql.end({ timeout: 1 });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error &&
        error.message ===
          "Проверьте переменную окружения DEMO_ACCOUNT_PASSWORDS."
        ? error.message
        : "Не удалось подготовить демо-данные. Проверьте миграции и доступность БД.",
    );
    process.exitCode = 1;
  });
}
