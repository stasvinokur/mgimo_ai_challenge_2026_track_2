import type { Actor } from "@/application/ports/actor";
import type { Clock } from "@/application/ports/clock";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/application/shared/errors";
import {
  groupNotifications,
  isInternalNotificationLink,
} from "@/domain/notifications/quiet-mode";
import type { NotificationDto, NotificationsRepository } from "./ports";
import { parseLatestNotification, parseReadNotification } from "./schemas";

function safeDto(item: NotificationDto): NotificationDto {
  return {
    ...item,
    link: item.link && isInternalNotificationLink(item.link) ? item.link : null,
  };
}

export class GetMyNotifications {
  constructor(private readonly repository: NotificationsRepository) {}
  async execute(actor: Actor) {
    if (actor.kind !== "student") throw new ForbiddenError();
    const [items, announcements] = await Promise.all([
      this.repository.listForUser(actor.userId),
      this.repository.listAnnouncementsForStudent(
        actor.studentId,
        actor.userId,
      ),
    ]);
    return { ...groupNotifications(items.map(safeDto)), announcements };
  }
}
export type NotificationsFeedDto = Awaited<
  ReturnType<GetMyNotifications["execute"]>
>;

export class GetMyPulse {
  constructor(private readonly repository: NotificationsRepository) {}
  async execute(actor: Actor) {
    if (actor.kind !== "student") throw new ForbiddenError();
    return this.repository.getPulseForUser(actor.userId);
  }
}

export class GetLatestNotificationTitle {
  constructor(private readonly repository: NotificationsRepository) {}
  async execute(actor: Actor, input: unknown) {
    if (actor.kind !== "student") throw new ForbiddenError();
    const { latestAt } = parseLatestNotification(input);
    const latest = await this.repository.findLatestForUser(actor.userId);
    return {
      latestTitle: latest?.createdAt === latestAt ? latest.title : null,
    };
  }
}

export class ReadMyNotification {
  constructor(
    private readonly repository: NotificationsRepository,
    private readonly clock: Clock,
  ) {}
  async execute(actor: Actor, input: unknown) {
    if (actor.kind !== "student") throw new ForbiddenError();
    const { id, open } = parseReadNotification(input);
    const item = await this.repository.findByIdForUser(id, actor.userId);
    if (!item) throw new NotFoundError();
    if (open && (!item.link || !isInternalNotificationLink(item.link))) {
      throw new ValidationError({
        link: ["notificationLinkUnavailable"],
      });
    }
    if (
      !(await this.repository.markReadForUser(
        id,
        actor.userId,
        this.clock.now().toISOString(),
      ))
    ) {
      throw new NotFoundError();
    }
    return { link: open ? item.link : null };
  }
}

export class ReadAllMyNotifications {
  constructor(
    private readonly repository: NotificationsRepository,
    private readonly clock: Clock,
  ) {}
  async execute(actor: Actor) {
    if (actor.kind !== "student") throw new ForbiddenError();
    await this.repository.markAllReadForUser(
      actor.userId,
      this.clock.now().toISOString(),
    );
  }
}
