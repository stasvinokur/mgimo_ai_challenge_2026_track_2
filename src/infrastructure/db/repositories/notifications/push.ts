import type { Sql } from "postgres";
import type {
  PendingPushNotification,
  PushQueue,
  PushSubscriptionsRepository,
  StoredPushSubscription,
} from "@/application/notifications/push-ports";
import type { IdGenerator } from "@/application/ports/id-generator";
import type {
  PushResult,
  PushSubscription,
} from "@/application/ports/push-sender";

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};
function subscription(row: SubscriptionRow): StoredPushSubscription {
  return {
    id: row.id,
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
  };
}

export class PostgresPushRepository
  implements PushSubscriptionsRepository, PushQueue
{
  constructor(
    private readonly database: () => Sql,
    private readonly ids: IdGenerator,
  ) {}

  async listForUser(userId: string) {
    const rows = await this.database()<SubscriptionRow[]>`
      select id, endpoint, p256dh, auth from push_subscriptions where user_id = ${userId}
      order by created_at desc, id desc limit 5`;
    return rows.map(subscription);
  }

  async saveForUser(userId: string, item: PushSubscription) {
    return this.database().begin(async (sql) => {
      // Serialize the insert and pruning together, including concurrent new devices.
      await sql`select pg_advisory_xact_lock(hashtextextended(${`push-subscriptions:${userId}`}, 0))`;
      const rows = await sql`
        insert into push_subscriptions (id, user_id, endpoint, p256dh, auth)
        values (${this.ids.next()}, ${userId}, ${item.endpoint}, ${item.keys.p256dh}, ${item.keys.auth})
        on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, failures = 0
        where push_subscriptions.user_id = excluded.user_id returning id`;
      if (rows.length === 0) return false;
      await sql`delete from push_subscriptions where user_id = ${userId} and id in (
        select id from push_subscriptions where user_id = ${userId}
        order by created_at desc, id desc offset 5
      )`;
      return true;
    });
  }

  async deleteForUser(userId: string, endpoint: string) {
    const rows = await this.database()`delete from push_subscriptions
      where user_id = ${userId} and endpoint = ${endpoint} returning id`;
    return rows.length > 0;
  }

  async claimForUser(userId: string, since: string, at: string) {
    // A single statement commits the terminal claim before any sender is invoked.
    return this.database()<PendingPushNotification[]>`
      update notifications set pushed_at = ${at}::timestamptz where user_id = ${userId} and id in (
        select id from notifications where user_id = ${userId} and pushed_at is null
          and created_at >= ${since}::timestamptz and created_at <= ${at}::timestamptz
          and exists (select 1 from push_subscriptions where user_id = ${userId})
        order by created_at, id for update skip locked
      ) returning id, kind, link`;
  }

  async recordResultForUser(
    userId: string,
    item: StoredPushSubscription,
    status: PushResult["status"],
  ) {
    if (status === "disabled") return;
    await this.database().begin(async (sql) => {
      const [row] = await sql<
        { failures: number }[]
      >`select failures from push_subscriptions
        where user_id = ${userId} and id = ${item.id} and endpoint = ${item.endpoint}
          and p256dh = ${item.keys.p256dh} and auth = ${item.keys.auth} for update`;
      if (!row) return;
      if (status === "gone" || (status === "failed" && row.failures >= 2)) {
        await sql`delete from push_subscriptions where user_id = ${userId} and id = ${item.id}`;
      } else {
        await sql`update push_subscriptions set failures = ${status === "sent" ? 0 : row.failures + 1}
          where user_id = ${userId} and id = ${item.id}`;
      }
    });
  }

  async findUserForStaffRequest(
    requestId: string,
    facultyIds: readonly string[],
  ) {
    if (facultyIds.length === 0) return null;
    const sql = this.database();
    const [row] = await sql<{ userId: string }[]>`select s.user_id as "userId"
      from requests r join students s on s.id = r.student_id
      where r.id = ${requestId} and s.faculty_id in ${sql([...facultyIds])}`;
    return row?.userId ?? null;
  }
}
