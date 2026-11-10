import {
  LOGIN_LIMITS,
  LOGIN_WINDOW_SEC,
} from "../../domain/identity/session-policy";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { Logger } from "../ports/logger";
import type { PasswordHasher } from "../ports/password-hasher";
import type { RateLimiter } from "../ports/rate-limiter";
import type { SessionStore } from "../ports/session-store";
import { RateLimitedError, ValidationError } from "../shared/errors";
import { createLoginSession } from "./create-login-session";
import type { IdentityRepository, SessionTokens } from "./ports";
import { parseLogin } from "./schemas";

export class Login {
  constructor(
    private readonly deps: {
      users: IdentityRepository;
      sessions: SessionStore;
      limiter: RateLimiter;
      passwords: PasswordHasher;
      tokens: SessionTokens;
      clock: Clock;
      ids: IdGenerator;
      logger: Logger;
      dummyHash: () => Promise<string>;
    },
  ) {}

  async execute(input: unknown, previousToken?: string) {
    const { login, password, ip } = parseLogin(input);
    const d = this.deps;
    // SHA-256 pseudonymizes these keys; it does not anonymize them.
    const reservation = await d.limiter.reserve([
      {
        key: `pair:${d.tokens.hash(`${login}\0${ip}`)}`,
        limit: LOGIN_LIMITS.pair,
        windowSec: LOGIN_WINDOW_SEC,
      },
      {
        key: `ip:${d.tokens.hash(ip)}`,
        limit: LOGIN_LIMITS.ip,
        windowSec: LOGIN_WINDOW_SEC,
      },
      {
        key: `login:${d.tokens.hash(login)}`,
        limit: LOGIN_LIMITS.login,
        windowSec: LOGIN_WINDOW_SEC,
      },
    ]);
    if (!reservation) {
      d.logger.warn("login_rate_limited", { code: "LOGIN_RATE_LIMITED" });
      throw new RateLimitedError();
    }
    let failed = false;
    try {
      const credentials = await d.users.findCredentials(login);
      const matches = await d.passwords.verify(
        credentials?.passwordHash ?? (await d.dummyHash()),
        password,
      );
      const actor =
        credentials && matches
          ? await d.users.findActorByUserId(credentials.userId)
          : null;
      if (!actor) {
        await reservation.commitFailure();
        failed = true;
        d.logger.warn("login_failed", { code: "INVALID_CREDENTIALS" });
        throw new ValidationError({
          credentials: ["Неверный логин или пароль"],
        });
      }
      return await createLoginSession(d, actor, previousToken);
    } finally {
      if (!failed) await reservation.release();
    }
  }
}
