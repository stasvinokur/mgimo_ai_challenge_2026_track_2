import { createDatabase } from "@/infrastructure/db/client";

export async function readDemoAccountCounts(
  sql: ReturnType<typeof createDatabase>,
) {
  return sql<{ login: string; requests: number; notifications: number }[]>`
    select u.login,
      (select count(*)::int from requests r join students s on s.id = r.student_id
        where s.user_id = u.id) as requests,
      (select count(*)::int from notifications n where n.user_id = u.id) as notifications
    from users u where u.login in ('anna', 'timur', 'marina') order by u.login`;
}

if (import.meta.main) {
  const sql = createDatabase(1);
  try {
    console.log(JSON.stringify(await readDemoAccountCounts(sql), null, 2));
  } finally {
    await sql.end({ timeout: 1 });
  }
}
