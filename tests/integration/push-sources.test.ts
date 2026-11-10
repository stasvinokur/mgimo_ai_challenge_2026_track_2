import { describe, expect, it, vi } from "vitest";
import { DispatchPush } from "@/application/notifications/push";
import type { TeacherPushRecipient } from "@/application/notifications/push-ports";
import { TeacherGradePushAccess } from "@/application/notifications/push-teacher";
import type { PushSubscription } from "@/application/ports/push-sender";
import { ForbiddenError } from "@/application/shared/errors";
import { SetTeacherGrade } from "@/application/teacher/gradebook";
import {
  PUSH_GENERIC_BODY,
  PUSH_REQUEST_BODY,
} from "@/domain/notifications/push-policy";
import { createDatabase } from "@/infrastructure/db/client";
import { PostgresRateLimiter } from "@/infrastructure/db/repositories/identity/rate-limiter";
import { PostgresPushRepository } from "@/infrastructure/db/repositories/notifications/push";
import { PostgresTeacherGradebookUnitOfWork } from "@/infrastructure/db/repositories/teacher/gradebook";
import { FakeClock } from "../fakes/clock";
import { marina } from "../fakes/identity";
import { FakePushSender } from "../fakes/push";
import { openPickupFixture } from "./pickup-data";
import {
  openTeacherGradesTestData,
  type TeacherGradesTestData,
} from "./teacher-grades-data";

function subscription(id: string): PushSubscription {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
    keys: { p256dh: `B${"a".repeat(86)}`, auth: "a".repeat(22) },
  };
}

function gradeServices(f: TeacherGradesTestData) {
  const { sql, ids } = f.teacher;
  const clock = new FakeClock(`${f.key.occurrenceDate}T09:00:00Z`);
  const uow = new PostgresTeacherGradebookUnitOfWork(() => sql, ids);
  const repository = new PostgresPushRepository(() => sql, ids);
  const sender = new FakePushSender();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return {
    clock,
    repository,
    sender,
    logger,
    set: new SetTeacherGrade(
      uow,
      clock,
      ids,
      new PostgresRateLimiter(() => sql, clock, ids),
    ),
    dispatch: new DispatchPush(
      repository,
      () => sender,
      clock,
      logger,
      new TeacherGradePushAccess(uow, clock),
    ),
  };
}

describe.skipIf(!process.env.DATABASE_URL)(
  "Push новых источников на PostgreSQL",
  () => {
    it("вызов в окно и выдача создают по одной отправке после commit; ошибка push не отменяет выдачу", async () => {
      const f = await openPickupFixture();
      const observer = createDatabase(1);
      try {
        f.clock.set("2026-11-09T06:00:00Z");
        const requestId = await f.ready();
        const booking = await f.book.execute(f.anna, {
          id: requestId,
          windowId: f.windowId,
          slotStartsAt: "2026-11-09T08:00:00Z",
        });
        await f.sql`delete from notifications where user_id = ${f.anna.userId}`;
        const repository = new PostgresPushRepository(() => f.sql, f.ids);
        const own = subscription(f.ids.next());
        await repository.saveForUser(f.anna.userId, own);
        const sender = new FakePushSender();
        const dispatch = new DispatchPush(
          repository,
          () => sender,
          f.clock,
          f.logger,
        );
        const snapshots: {
          status: string | undefined;
          pushedAt: string | undefined;
        }[] = [];
        sender.beforeSend = async () => {
          const [row] = await observer<
            { status: string; pushedAt: Date | null }[]
          >`
          select b.status, n.pushed_at as "pushedAt" from pickup_bookings b
          join notifications n on n.link = ${`/requests/${requestId}`} and n.user_id = ${f.anna.userId}
          where b.id = ${booking.id} order by n.created_at desc, n.id desc limit 1`;
          snapshots.push({
            status: row?.status,
            pushedAt: row?.pushedAt?.toISOString(),
          });
        };
        f.clock.set("2026-11-09T08:00:00Z");
        const called = await f.changePickup.execute(f.limited, {
          id: booking.id,
          to: "called",
        });
        expect(sender.calls).toEqual([]);
        await dispatch.executeForRequest(f.limited, called.requestId);
        await dispatch.executeForRequest(f.limited, called.requestId);
        expect(sender.calls).toHaveLength(1);
        expect(sender.calls[0]?.payload).toEqual({
          title: "Пульс",
          body: PUSH_REQUEST_BODY,
          link: `/requests/${requestId}`,
        });
        sender.result = { status: "failed" };
        const served = await f.changePickup.execute(f.limited, {
          id: booking.id,
          to: "served",
        });
        await dispatch.executeForRequest(f.limited, served.requestId);
        await dispatch.executeForRequest(f.limited, served.requestId);
        expect(sender.calls).toHaveLength(2);
        expect(snapshots).toEqual([
          { status: "called", pushedAt: f.clock.now().toISOString() },
          { status: "served", pushedAt: f.clock.now().toISOString() },
        ]);
        const [request] = await f.sql<
          { status: string }[]
        >`select status from requests where id = ${requestId}`;
        expect(request?.status).toBe("issued");
      } finally {
        await observer.end({ timeout: 1 });
        await f.close();
      }
    });

    it("чужой факультет и студент не получают отправку вызова и не захватывают очередь", async () => {
      const f = await openPickupFixture();
      try {
        f.clock.set("2026-11-09T06:00:00Z");
        const requestId = await f.ready(f.timur);
        const booking = await f.book.execute(f.timur, {
          id: requestId,
          windowId: f.foreignWindowId,
          slotStartsAt: "2026-11-09T08:00:00Z",
        });
        await f.sql`delete from notifications where user_id = ${f.timur.userId}`;
        const repository = new PostgresPushRepository(() => f.sql, f.ids);
        await repository.saveForUser(
          f.timur.userId,
          subscription(f.ids.next()),
        );
        const sender = new FakePushSender();
        const dispatch = new DispatchPush(
          repository,
          () => sender,
          f.clock,
          f.logger,
        );
        f.clock.set("2026-11-09T08:00:00Z");
        const caller = { ...f.limited, facultyIds: [f.foreignFacultyId] };
        await f.changePickup.execute(caller, { id: booking.id, to: "called" });
        await dispatch.executeForRequest(f.limited, requestId);
        await expect(
          dispatch.executeForRequest(f.anna, requestId),
        ).rejects.toBeInstanceOf(ForbiddenError);
        expect(sender.calls).toEqual([]);
        const [pending] = await f.sql<{ pushedAt: Date | null }[]>`
        select pushed_at as "pushedAt" from notifications where link = ${`/requests/${requestId}`} and user_id = ${f.timur.userId}`;
        expect(pending?.pushedAt).toBeNull();
      } finally {
        await f.close();
      }
    });

    it("новый балл и исправление отправляются после commit без балла, дисциплины и причины в payload", async () => {
      const f = await openTeacherGradesTestData();
      const observer = createDatabase(1);
      try {
        const s = gradeServices(f);
        await f.teacher
          .sql`delete from notifications where user_id = ${f.student.actor.userId}`;
        await s.repository.saveForUser(
          f.student.actor.userId,
          subscription(f.teacher.ids.next()),
        );
        const snapshots: {
          score: number | undefined;
          pushedAt: string | undefined;
        }[] = [];
        s.sender.beforeSend = async () => {
          const [row] = await observer<
            { score: number; pushedAt: Date | null }[]
          >`
          select sc.score, n.pushed_at as "pushedAt" from scores sc
          join notifications n on n.link = ${`/grades/${f.courseId}`} and n.user_id = ${f.student.actor.userId}
          where sc.assessment_id = ${f.workId} and sc.student_id = ${f.student.actor.studentId}
          order by n.created_at desc, n.id desc limit 1`;
          snapshots.push({
            score: row?.score,
            pushedAt: row?.pushedAt?.toISOString(),
          });
        };
        const first = await s.set.executeWithRecipient(f.teacher.actor, {
          ...f.key,
          entryKey: f.entryKey,
          score: 81,
          expectedScore: null,
        });
        expect(first.pushRecipient).toEqual({
          ...f.key,
          entryKey: f.entryKey,
          userId: f.student.actor.userId,
        });
        expect(s.sender.calls).toEqual([]);
        if (!first.pushRecipient)
          throw new Error("Нет серверного получателя новой оценки.");
        await s.dispatch.executeForTeacherGrade(
          f.teacher.actor,
          first.pushRecipient,
        );
        await s.dispatch.executeForTeacherGrade(
          f.teacher.actor,
          first.pushRecipient,
        );
        expect(s.sender.calls).toHaveLength(1);
        expect(s.sender.calls[0]?.payload).toEqual({
          title: "Пульс",
          body: PUSH_GENERIC_BODY,
          link: `/grades/${f.courseId}`,
        });
        s.sender.result = { status: "failed" };
        const corrected = await s.set.executeWithRecipient(f.teacher.actor, {
          ...f.key,
          entryKey: f.entryKey,
          score: 92,
          expectedScore: 81,
          reason: "retake",
        });
        if (!corrected.pushRecipient)
          throw new Error("Нет серверного получателя исправленной оценки.");
        await s.dispatch.executeForTeacherGrade(
          f.teacher.actor,
          corrected.pushRecipient,
        );
        await s.dispatch.executeForTeacherGrade(
          f.teacher.actor,
          corrected.pushRecipient,
        );
        expect(s.sender.calls).toHaveLength(2);
        expect(snapshots).toEqual([
          { score: 81, pushedAt: s.clock.now().toISOString() },
          { score: 92, pushedAt: s.clock.now().toISOString() },
        ]);
        expect(s.sender.calls[1]?.payload).toEqual({
          title: "Пульс",
          body: PUSH_GENERIC_BODY,
          link: `/grades/${f.courseId}`,
        });
        const [score] = await f.teacher.sql<
          { score: number }[]
        >`select score from scores where assessment_id = ${f.workId} and student_id = ${f.student.actor.studentId}`;
        expect(score?.score).toBe(92);
        expect(s.logger.warn).toHaveBeenCalledWith("push_send_failed");
      } finally {
        await observer.end({ timeout: 1 });
        await f.close();
      }
    });

    it("повторная проверка ведомости отвергает чужого студента, пару, ячейку и преподавателя без отправки", async () => {
      const f = await openTeacherGradesTestData();
      const foreign = await openTeacherGradesTestData();
      try {
        const s = gradeServices(f);
        await f.teacher
          .sql`delete from notifications where user_id = ${f.student.actor.userId}`;
        await s.repository.saveForUser(
          f.student.actor.userId,
          subscription(f.teacher.ids.next()),
        );
        await s.repository.saveForUser(
          foreign.student.actor.userId,
          subscription(f.teacher.ids.next()),
        );
        const result = await s.set.executeWithRecipient(f.teacher.actor, {
          ...f.key,
          entryKey: f.entryKey,
          score: 81,
          expectedScore: null,
        });
        if (!result.pushRecipient)
          throw new Error("Нет серверного получателя.");
        const recipient = result.pushRecipient;
        const foreignNotification = f.teacher.ids.next();
        await f.teacher
          .sql`insert into notifications (id, user_id, kind, title, body, link, created_at)
        values (${foreignNotification}, ${foreign.student.actor.userId}, 'change', 'Чужая новая оценка', 'Не передаётся в push', ${`/grades/${foreign.courseId}`}, ${s.clock.now().toISOString()}::timestamptz)`;
        const denied: TeacherPushRecipient[] = [
          { ...recipient, userId: foreign.student.actor.userId },
          { ...recipient, ...foreign.key },
          { ...recipient, entryKey: foreign.entryKey },
        ];
        for (const target of denied)
          await s.dispatch.executeForTeacherGrade(f.teacher.actor, target);
        await s.dispatch.executeForTeacherGrade(
          foreign.teacher.actor,
          recipient,
        );
        for (const actor of [f.student.actor, marina])
          await expect(
            s.dispatch.executeForTeacherGrade(actor, recipient),
          ).rejects.toBeInstanceOf(ForbiddenError);
        expect(s.sender.calls).toEqual([]);
        const rows = await f.teacher.sql<{ pushedAt: Date | null }[]>`
        select pushed_at as "pushedAt" from notifications where user_id = ${f.student.actor.userId} or id = ${foreignNotification}`;
        expect(rows).toHaveLength(2);
        expect(rows.every((row) => row.pushedAt === null)).toBe(true);
        await s.dispatch.executeForTeacherGrade(f.teacher.actor, recipient);
        expect(s.sender.calls).toHaveLength(1);
        const [untouched] = await f.teacher.sql<
          { pushedAt: Date | null }[]
        >`select pushed_at as "pushedAt" from notifications where id = ${foreignNotification}`;
        expect(untouched?.pushedAt).toBeNull();
      } finally {
        await foreign.close();
        await f.close();
      }
    });
  },
);
