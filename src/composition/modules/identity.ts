import "server-only";
import { GetCurrentActor } from "@/application/identity/get-current-actor";
import { GetStaffProfile } from "@/application/identity/get-staff-profile";
import { Login } from "@/application/identity/login";
import { Logout } from "@/application/identity/logout";
import { Passkeys } from "@/application/identity/passkeys";
import { Argon2PasswordHasher } from "@/infrastructure/auth/argon2-password-hasher";
import { SimpleWebAuthnPasskeyVerifier } from "@/infrastructure/auth/passkey-verifier";
import { getClientIp } from "@/infrastructure/auth/request-ip";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/infrastructure/auth/session-cookie";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { getDatabase } from "@/infrastructure/db/client";
import { PostgresPasskeyRepository } from "@/infrastructure/db/repositories/identity/passkeys";
import { PostgresRateLimiter } from "@/infrastructure/db/repositories/identity/rate-limiter";
import { PostgresSessionStore } from "@/infrastructure/db/repositories/identity/sessions";
import { PostgresIdentityRepository } from "@/infrastructure/db/repositories/identity/users";
import type { createSystemModule } from "./system";

export function createIdentityModule(
  system: ReturnType<typeof createSystemModule>,
) {
  const users = new PostgresIdentityRepository(getDatabase);
  const sessions = new PostgresSessionStore(getDatabase);
  const tokens = new CryptoSessionTokens();
  const passwords = new Argon2PasswordHasher();
  // Public dummy hash with the same Argon2id cost as real accounts.
  const dummyHash =
    "$argon2id$v=19$m=19456,t=2,p=1$FeYYMEYZcGYRN+hqjSubQw$aiVducRJuyL3V20bCcOKkxKpdws32JF4BufI9LtSWBs";
  return {
    login: new Login({
      users,
      sessions,
      tokens,
      passwords,
      limiter: new PostgresRateLimiter(getDatabase, system.clock, system.ids),
      ...system,
      dummyHash: async () => dummyHash,
    }),
    getCurrentActor: new GetCurrentActor(sessions, users, tokens, system.clock),
    logout: new Logout(sessions, tokens, system.clock, system.logger),
    getStaffProfile: new GetStaffProfile(users),
    get passkeys() {
      return new Passkeys({
        users,
        sessions,
        tokens,
        repository: new PostgresPasskeyRepository(getDatabase),
        verifier: new SimpleWebAuthnPasskeyVerifier(
          system.getEnv("APP_ORIGIN"),
          system.logger,
        ),
        limiter: new PostgresRateLimiter(getDatabase, system.clock, system.ids),
        ...system,
      });
    },
    getAppOrigin: () => system.getEnv("APP_ORIGIN"),
    get demoLoginHints() {
      return system.getEnv("DEMO_LOGIN_HINTS") === "on";
    },
    getClientIp,
    sessionCookie: { name: SESSION_COOKIE, options: sessionCookieOptions },
  };
}
