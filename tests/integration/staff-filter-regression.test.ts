import { expect, it } from "vitest";
import { openDemoStaffFixture } from "./staff-demo-fixture";

it("мои просроченные заявки различают демо-сотрудников с одинаковым именем по staffId", async () => {
  const f = await openDemoStaffFixture();
  try {
    if (f.marina.kind !== "staff" || f.limited.kind !== "staff")
      throw new Error("Нужны сотрудники.");
    await f.sql`update users set seed_key = ${`staff-filter-other:${f.limited.userId}`} where id = ${f.limited.userId}`;
    await f.sql`update staff set full_name = (select full_name from staff where id = ${f.marina.staffId}) where id = ${f.limited.staffId}`;
    const id = await f.request();
    await f.change.execute(f.marina, { id, to: "accepted" });
    await f.sql`update requests set due_at = '2019-01-01T09:00:00Z' where id = ${id}`;
    const row = await f.get.execute(f.marina, { id });
    const filters = {
      type: "enrollment",
      scope: "mine",
      q: row.publicNo,
      sla: "overdue",
    };
    const [saved] =
      await f.sql`select assignee_staff_id from requests where id = ${id}`;
    expect(saved?.assignee_staff_id).toBe(f.marina.staffId);
    const own = await f.list.execute(f.marina, filters);
    expect(own.filters).toEqual(filters);
    expect(own.requests.map((request) => request.id)).toEqual([id]);
    expect(own.requests[0]?.sla).toBe("overdue");
    const other = await f.list.execute(f.limited, filters);
    expect(other.requests).toEqual([]);
  } finally {
    await f.close();
  }
});
