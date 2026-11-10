import { createDatabase } from "@/infrastructure/db/client";

export async function cleanupRequestsForTest(destination: string) {
  if (!process.env.DATABASE_URL) return;
  const sql = createDatabase(1);
  try {
    await sql.begin(async (tx) => {
      const rows = await tx<
        { id: string }[]
      >`select id from requests where seed_key is null and payload->>'destination' = ${destination}`;
      for (const { id } of rows) {
        await tx`delete from notifications where link = ${`/requests/${id}`}`;
        await tx`delete from certificates where request_id = ${id}`;
        await tx`delete from requests where id = ${id}`;
      }
    });
  } finally {
    await sql.end({ timeout: 1 });
  }
}
