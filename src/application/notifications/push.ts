import type { Actor } from "@/application/ports/actor";
import type { Clock } from "@/application/ports/clock";
import type { Logger } from "@/application/ports/logger";
import type { PushResult, PushSender } from "@/application/ports/push-sender";
import type { RateLimiter } from "@/application/ports/rate-limiter";
import {
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from "@/application/shared/errors";
import {
  PUSH_GENERIC_BODY,
  PUSH_REQUEST_BODY,
  PUSH_TEST_BODY,
} from "@/domain/notifications/push-policy";
import { isInternalNotificationLink } from "@/domain/notifications/quiet-mode";
import { parsePushEndpoint, parsePushSubscription } from "./push/schemas";
import type {
  PushQueue,
  PushSubscriptionsRepository,
  TeacherPushAccess,
  TeacherPushRecipient,
} from "./push-ports";

function student(actor: Actor) {
  if (actor.kind !== "student") throw new ForbiddenError();
  return actor;
}

async function reserve(limiter: RateLimiter, userId: string, test = false) {
  const rules = [{ key: `push:${userId}`, limit: 30, windowSec: 600 }];
  if (test) rules.push({ key: `push-test:${userId}`, limit: 3, windowSec: 60 });
  const reservation = await limiter.reserve(rules);
  if (!reservation) throw new RateLimitedError();
  // Both successful and rejected mutations consume the authenticated user's quota.
  await reservation.commitFailure();
}

export class GetPushConfiguration {
  constructor(
    private readonly subscriptions: PushSubscriptionsRepository,
    private readonly publicKey: () => string | null,
  ) {}

  async execute(actor: Actor) {
    student(actor);
    return {
      publicKey: this.publicKey(),
      endpoints: (await this.subscriptions.listForUser(actor.userId)).map(
        (item) => item.endpoint,
      ),
    };
  }
}

export class SubscribeToPush {
  constructor(
    private readonly subscriptions: PushSubscriptionsRepository,
    private readonly sender: () => PushSender,
    private readonly limiter: RateLimiter,
  ) {}

  async execute(actor: Actor, input: unknown) {
    student(actor);
    await reserve(this.limiter, actor.userId);
    const subscription = parsePushSubscription(input);
    if (!this.sender().enabled)
      throw new ValidationError({
        subscription: ["Уведомления на телефон пока не настроены на сервере."],
      });
    if (!(await this.subscriptions.saveForUser(actor.userId, subscription)))
      throw new NotFoundError();
    return { ok: true as const };
  }
}

export class UnsubscribeFromPush {
  constructor(
    private readonly subscriptions: PushSubscriptionsRepository,
    private readonly limiter: RateLimiter,
  ) {}

  async execute(actor: Actor, input: unknown) {
    student(actor);
    await reserve(this.limiter, actor.userId);
    const { endpoint } = parsePushEndpoint(input);
    if (!(await this.subscriptions.deleteForUser(actor.userId, endpoint)))
      throw new NotFoundError();
    return { ok: true as const };
  }
}

export class TestPush {
  constructor(
    private readonly subscriptions: PushSubscriptionsRepository,
    private readonly sender: () => PushSender,
    private readonly limiter: RateLimiter,
    private readonly logger: Logger,
  ) {}

  async execute(actor: Actor, input: unknown) {
    student(actor);
    await reserve(this.limiter, actor.userId, true);
    const { endpoint } = parsePushEndpoint(input);
    const subscription = (
      await this.subscriptions.listForUser(actor.userId)
    ).find((item) => item.endpoint === endpoint);
    if (!subscription) throw new NotFoundError();
    let status: PushResult["status"] = "failed";
    try {
      status = (
        await this.sender().send(subscription, {
          title: "Пульс",
          body: PUSH_TEST_BODY,
          link: "/notifications",
        })
      ).status;
    } catch {
      this.logger.warn("push_send_failed");
    }
    await this.subscriptions.recordResultForUser(
      actor.userId,
      subscription,
      status,
    );
    if (status !== "sent") {
      this.logger.warn("push_test_unavailable");
      throw new ValidationError({
        subscription: [
          "Не удалось доставить проверку. Включите уведомления заново или повторите позже.",
        ],
      });
    }
    return { ok: true as const };
  }
}

export class DispatchPush {
  constructor(
    private readonly queue: PushQueue & PushSubscriptionsRepository,
    private readonly sender: () => PushSender,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly teacherAccess?: TeacherPushAccess,
  ) {}

  async executeForTeacherGrade(actor: Actor, recipient: TeacherPushRecipient) {
    if (actor.kind !== "teacher") throw new ForbiddenError();
    try {
      if (
        !this.teacherAccess ||
        !(await this.teacherAccess.canNotifyStudent(actor.teacherId, recipient))
      )
        return;
      await this.dispatchForUser(recipient.userId);
    } catch {
      this.logger.warn("push_dispatch_failed");
    }
  }

  async executeForRequest(actor: Actor, requestId: string) {
    if (actor.kind !== "staff") throw new ForbiddenError();
    try {
      const userId = await this.queue.findUserForStaffRequest(
        requestId,
        actor.facultyIds,
      );
      if (userId) await this.dispatchForUser(userId);
    } catch {
      this.logger.warn("push_dispatch_failed");
    }
  }

  async execute(actor: Actor) {
    student(actor);
    await this.dispatchForUser(actor.userId);
  }

  private async dispatchForUser(userId: string) {
    try {
      const sender = this.sender();
      if (!sender.enabled) return;
      const now = this.clock.now();
      const since = new Date(now.getTime() - 300_000).toISOString();
      const subscriptions = (await this.queue.listForUser(userId)).slice(0, 5);
      if (subscriptions.length === 0) return;
      const items = await this.queue.claimForUser(
        userId,
        since,
        now.toISOString(),
      );
      if (items.length === 0) return;
      const item = items.length === 1 ? items[0] : undefined;
      const payload = {
        title: "Пульс",
        body: item?.kind === "request" ? PUSH_REQUEST_BODY : PUSH_GENERIC_BODY,
        link:
          item && isInternalNotificationLink(item.link)
            ? item.link
            : "/notifications",
      };
      let expired = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<PushResult>((resolve) => {
        timer = setTimeout(() => {
          expired = true;
          resolve({ status: "failed" });
        }, 5000);
      });
      let next = 0;
      try {
        await Promise.allSettled(
          Array.from(
            { length: Math.min(3, subscriptions.length) },
            async () => {
              for (;;) {
                const subscription = subscriptions[next++];
                if (!subscription) return;
                const result: PushResult = expired
                  ? { status: "failed" }
                  : await Promise.race([
                      Promise.resolve()
                        .then(() => sender.send(subscription, payload))
                        .catch((): PushResult => ({ status: "failed" })),
                      deadline,
                    ]);
                if (result.status === "failed")
                  this.logger.warn("push_send_failed");
                try {
                  await this.queue.recordResultForUser(
                    userId,
                    subscription,
                    result.status,
                  );
                } catch {
                  this.logger.warn("push_result_failed");
                }
              }
            },
          ),
        );
      } finally {
        clearTimeout(timer);
      }
    } catch {
      this.logger.warn("push_dispatch_failed");
    }
  }
}
