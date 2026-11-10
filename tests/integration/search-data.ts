import { createDatabase } from "@/infrastructure/db/client";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";

export async function createSearchRequest(studentId: string) {
  const sql = createDatabase(1);
  const id = new UuidV7Generator().next();
  const publicNo = `ТЕСТ-${id.slice(-12)}`;
  try {
    await sql`insert into requests (id, public_no, student_id, type_code, payload, status) values (${id}, ${publicNo}, ${studentId}, 'enrollment', '{"destination":"Тест поиска"}'::jsonb, 'submitted')`;
    return { id, publicNo };
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export async function searchRequestsForStudent(studentId: string) {
  const sql = createDatabase(1);
  try {
    return await sql<
      { id: string; publicNo: string }[]
    >`select id, public_no as "publicNo" from requests where student_id = ${studentId} order by created_at, id`;
  } finally {
    await sql.end({ timeout: 1 });
  }
}
