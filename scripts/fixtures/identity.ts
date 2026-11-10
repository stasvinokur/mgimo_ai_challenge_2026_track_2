import { demoAccounts } from "../../src/application/identity/demo-accounts";
import type { PasswordHasher } from "../../src/application/ports/password-hasher";
import type { users } from "../../src/infrastructure/db/schema/identity";
import type { FixtureContext } from "./shared";

export { demoAccounts } from "../../src/application/identity/demo-accounts";

export async function identityFixtures(
  ctx: FixtureContext,
  hasher: PasswordHasher,
  passwords?: Readonly<Record<(typeof demoAccounts)[number]["login"], string>>,
): Promise<(typeof users.$inferInsert)[]> {
  return Promise.all(
    demoAccounts.map(async (account) => ({
      ...ctx.row(`user:${account.login}`),
      login: account.login,
      role: account.role,
      passwordHash: await hasher.hash(
        passwords?.[account.login] ?? account.password,
      ),
      createdAt: ctx.at(-30),
    })),
  );
}
