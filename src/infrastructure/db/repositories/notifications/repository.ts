import type { Sql } from "postgres";
import type {
  AnnouncementDto,
  NotificationDto,
  NotificationsRepository,
  PulseDto,
} from "@/application/notifications/ports";

type NotificationRow = Omit<NotificationDto, "createdAt" | "readAt"> & {
  createdAt: Date;
  readAt: Date | null;
};
function dto(row: NotificationRow): NotificationDto {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  };
}

export class PostgresNotificationsRepository
  implements NotificationsRepository
{
  constructor(private readonly database: () => Sql) {}

  async listForUser(userId: string) {
    const rows = await this.database()<NotificationRow[]>`
      select id, kind, priority, title, body, link, read_at as "readAt", created_at as "createdAt"
      from notifications where user_id = ${userId} order by created_at desc, id desc`;
    return rows.map(dto);
  }

  async findByIdForUser(id: string, userId: string) {
    const [row] = await this.database()<NotificationRow[]>`
      select id, kind, priority, title, body, link, read_at as "readAt", created_at as "createdAt"
      from notifications where id = ${id} and user_id = ${userId}`;
    return row ? dto(row) : null;
  }

  async markReadForUser(id: string, userId: string, at: string) {
    const rows =
      await this.database()`update notifications set read_at = coalesce(read_at, ${at}::timestamptz)
      where id = ${id} and user_id = ${userId} returning id`;
    return rows.length > 0;
  }

  async markAllReadForUser(userId: string, at: string) {
    await this.database()`update notifications set read_at = ${at}::timestamptz
      where user_id = ${userId} and read_at is null`;
  }

  async getPulseForUser(userId: string): Promise<PulseDto> {
    const [row] = await this.database()<
      { unread: number; latestAt: Date | null }[]
    >`
      select count(*) filter (where read_at is null)::int as unread,
        max(greatest(created_at, read_at)) as "latestAt"
      from notifications where user_id = ${userId}`;
    return {
      unread: row?.unread ?? 0,
      latestAt: row?.latestAt?.toISOString() ?? null,
    };
  }

  async findLatestForUser(userId: string) {
    const [row] = await this.database()<NotificationRow[]>`
      select id, kind, priority, title, body, link, read_at as "readAt", created_at as "createdAt"
      from notifications where user_id = ${userId} order by created_at desc, id desc limit 1`;
    return row ? dto(row) : null;
  }

  async listAnnouncementsForStudent(
    studentId: string,
    userId: string,
  ): Promise<AnnouncementDto[]> {
    const rows = await this.database()<
      (Omit<AnnouncementDto, "publishedAt"> & { publishedAt: Date })[]
    >`
      select a.id, a.title, a.body, a.published_at as "publishedAt"
      from announcements a join students s on s.id = ${studentId} and s.user_id = ${userId}
      where a.published_at <= now() and (
        a.audience = 'all' or
        (a.audience = 'faculty' and a.audience_ref = s.faculty_id::text) or
        (a.audience = 'course' and a.audience_ref = s.course::text) or
        (a.audience = 'group' and a.audience_ref = s.group_id::text))
      order by a.published_at desc, a.id desc`;
    return rows.map((row) => ({
      ...row,
      publishedAt: row.publishedAt.toISOString(),
    }));
  }
}
