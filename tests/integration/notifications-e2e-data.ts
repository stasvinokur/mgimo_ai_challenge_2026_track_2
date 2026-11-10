import { randomUUID } from "node:crypto";
import type { NotificationDto } from "@/application/notifications/ports";
import { createDatabase } from "@/infrastructure/db/client";
import { test as base } from "../security/student-login";

export async function openNotificationsTestData(userId: string) {
  const sql = createDatabase(1);
  const inserted: string[] = [];
  return {
    sql,
    async insert(input: {
      title: string;
      userId?: string;
      priority?: NotificationDto["priority"];
      kind?: NotificationDto["kind"];
      link?: string;
    }) {
      const id = randomUUID();
      inserted.push(id);
      await sql`insert into notifications (id, user_id, kind, priority, title, body, link)
        values (${id}, ${input.userId ?? userId}, ${input.kind ?? "news"}, ${input.priority ?? "normal"}, ${input.title}, 'Вымышленное уведомление для проверки.', ${input.link ?? "/schedule"})`;
      return id;
    },
    async readAt(id: string) {
      const [row] = await sql<
        { at: Date | null }[]
      >`select read_at as at from notifications where id = ${id}`;
      if (!row) throw new Error("Нет тестового уведомления.");
      return row.at;
    },
    async close() {
      try {
        for (const id of inserted)
          await sql`delete from notifications where id = ${id}`;
      } finally {
        await sql.end({ timeout: 1 });
      }
    },
  };
}

export const test = base.extend<{
  notificationsData: Awaited<ReturnType<typeof openNotificationsTestData>>;
  notificationTitle: string;
}>({
  notificationsData: async ({ baseURL, students }, use) => {
    base.skip(
      !process.env.DATABASE_URL,
      "Для подготовки уведомлений нужна БД лейна.",
    );
    if (!baseURL) throw new Error("Укажите адрес приложения.");
    const student = await students.get("anna");
    const data = await openNotificationsTestData(student.actor.userId);
    try {
      await use(data);
    } finally {
      await data.close();
    }
  },
  notificationTitle: async ({ baseURL }, use, info) => {
    if (!baseURL) throw new Error("Укажите адрес приложения.");
    await use(
      `Учебное уведомление · ${info.project.name} · ${info.retry} · ${randomUUID()}`,
    );
  },
});
