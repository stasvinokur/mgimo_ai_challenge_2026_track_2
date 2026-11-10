import { openStaffFixture } from "./staff-fixtures";

export async function openDemoStaffFixture() {
  const fixture = await openStaffFixture();
  try {
    await fixture.sql`update users set seed_key = ${`staff-demo-test:${fixture.marina.userId}`} where id = ${fixture.marina.userId}`;
    for (const actor of [fixture.anna, fixture.timur]) {
      await fixture.sql`update users set seed_key = ${`staff-demo-test:${actor.userId}`} where id = ${actor.userId}`;
      await fixture.sql`update students set seed_key = ${`staff-demo-test:${actor.studentId}`} where id = ${actor.studentId}`;
    }
    return fixture;
  } catch (error) {
    await fixture.close();
    throw error;
  }
}

export type DemoStaffFixture = Awaited<ReturnType<typeof openDemoStaffFixture>>;
