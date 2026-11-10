import {
  DEMO_PASSKEY_DEVICE_NAME,
  PASSKEY_AUTHENTICATION_ISSUANCE_LIMIT,
  PASSKEY_AUTHENTICATION_OPTIONS_LIMIT,
  PASSKEY_AUTHENTICATION_UNKNOWN_ISSUANCE_LIMIT,
  PASSKEY_CHALLENGE_TTL_MS,
  PASSKEY_CREDENTIAL_LIMIT,
  PASSKEY_ISSUANCE_WINDOW_SEC,
  PASSKEY_REAUTHENTICATION_WINDOW_MS,
  PASSKEY_REGISTRATION_ISSUANCE_LIMIT,
  PASSKEY_REGISTRATION_OPTIONS_LIMIT,
  PASSKEY_REGISTRATION_SUCCESS_LIMIT,
  PASSKEY_REGISTRATION_SUCCESS_WINDOW_SEC,
} from "../../domain/identity/passkey-policy";
import {
  LOGIN_LIMITS,
  LOGIN_WINDOW_SEC,
} from "../../domain/identity/session-policy";
import type { Actor } from "../ports/actor";
import type { PasskeyVerifier } from "../ports/passkey-verifier";
import type { RateLimiter } from "../ports/rate-limiter";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../shared/errors";
import {
  createLoginSession,
  type LoginSessionDependencies,
} from "./create-login-session";
import {
  PasskeyLimitError,
  PasskeyReauthenticationRequiredError,
  PasskeyRegistrationRateLimitedError,
} from "./passkey-errors";
import type {
  PasskeyRecord,
  PasskeyRepository,
  WebauthnChallengePurpose,
} from "./passkey-ports";
import type { IdentityRepository } from "./ports";
import {
  isPasskeyId,
  parsePasskeyAuthentication,
  parsePasskeyAuthenticationIp,
  parsePasskeyIp,
  parsePasskeyRegistration,
} from "./schemas";

export const PASSKEY_LOGIN_MESSAGE =
  "Не удалось войти с ключом доступа. Попробуйте снова или войдите по паролю.";
export const PASSKEY_REGISTRATION_MESSAGE =
  "Не удалось добавить ключ доступа. Попробуйте снова.";

export interface PasskeyDto {
  id: string;
  deviceName: string;
  createdAt: string;
  lastUsedAt: string | null;
}

function requirePasskeyActor(actor: Actor) {
  if (actor.kind !== "student" && actor.kind !== "staff")
    throw new ForbiddenError();
}

function publicKey(record: PasskeyRecord, isDemoAccount: boolean): PasskeyDto {
  return {
    id: record.id,
    deviceName: isDemoAccount ? DEMO_PASSKEY_DEVICE_NAME : record.deviceName,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
  };
}

function loginError() {
  return new ValidationError({ credentials: [PASSKEY_LOGIN_MESSAGE] });
}

export class Passkeys {
  constructor(
    private readonly deps: LoginSessionDependencies & {
      repository: PasskeyRepository;
      verifier: PasskeyVerifier;
      users: IdentityRepository;
      limiter: RateLimiter;
    },
  ) {}

  async isDemoAccount(actor: Actor): Promise<boolean> {
    requirePasskeyActor(actor);
    return this.deps.repository.isDemoAccount(actor.userId);
  }

  async list(actor: Actor): Promise<PasskeyDto[]> {
    requirePasskeyActor(actor);
    const [records, isDemoAccount] = await Promise.all([
      this.deps.repository.listForUser(actor.userId),
      this.isDemoAccount(actor),
    ]);
    return records.map((record) => publicKey(record, isDemoAccount));
  }

  async get(actor: Actor, id: unknown): Promise<PasskeyDto> {
    requirePasskeyActor(actor);
    if (!isPasskeyId(id)) throw new NotFoundError();
    const record = (await this.deps.repository.listForUser(actor.userId)).find(
      (key) => key.id === id,
    );
    if (!record) throw new NotFoundError();
    return publicKey(record, await this.isDemoAccount(actor));
  }

  async remove(actor: Actor, id: unknown) {
    requirePasskeyActor(actor);
    if (
      !isPasskeyId(id) ||
      (await this.isDemoAccount(actor)) ||
      !(await this.deps.repository.deleteForUser(id, actor.userId))
    )
      throw new NotFoundError();
  }

  private async saveChallenge(
    challenge: string,
    purpose: WebauthnChallengePurpose,
    userId: string | null,
    issuanceKey: string,
    issuanceLimit: number,
  ) {
    const d = this.deps;
    const reservation = await d.limiter.reserve([
      {
        key: issuanceKey,
        limit: issuanceLimit,
        windowSec: PASSKEY_ISSUANCE_WINDOW_SEC,
      },
    ]);
    if (!reservation)
      throw new ValidationError({ passkey: [PASSKEY_REGISTRATION_MESSAGE] });
    let id: string;
    try {
      id = d.ids.next();
      const now = d.clock.now();
      await d.repository.createChallenge({
        id,
        purpose,
        userId,
        challengeHash: d.tokens.hash(challenge),
        createdAt: now.toISOString(),
        expiresAt: new Date(
          now.getTime() + PASSKEY_CHALLENGE_TTL_MS,
        ).toISOString(),
      });
    } catch (error) {
      await reservation.release();
      throw error;
    }
    // Count issued challenges separately from failed authentication attempts.
    await reservation.commitFailure();
    return id;
  }

  private async requireFreshSession(actor: Actor, sessionToken?: string) {
    const d = this.deps;
    if (!sessionToken || !/^[A-Za-z0-9_-]{43}$/.test(sessionToken))
      throw new PasskeyReauthenticationRequiredError();
    const lookupNow = d.clock.now();
    const session = await d.sessions.findValid(
      d.tokens.hash(sessionToken),
      lookupNow,
    );
    const now = d.clock.now();
    const age = session ? now.getTime() - Date.parse(session.createdAt) : NaN;
    if (
      !session ||
      session.userId !== actor.userId ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > PASSKEY_REAUTHENTICATION_WINDOW_MS ||
      !(Date.parse(session.expiresAt) > now.getTime())
    )
      throw new PasskeyReauthenticationRequiredError();
  }

  async registrationOptions(actor: Actor, sessionToken?: string) {
    requirePasskeyActor(actor);
    const d = this.deps;
    await this.requireFreshSession(actor, sessionToken);
    const reservation = await d.limiter.reserve([
      {
        key: `passkey-registration-options:user:${d.tokens.hash(actor.userId)}`,
        limit: PASSKEY_REGISTRATION_OPTIONS_LIMIT,
        windowSec: LOGIN_WINDOW_SEC,
      },
    ]);
    if (!reservation)
      throw new ValidationError({ passkey: [PASSKEY_REGISTRATION_MESSAGE] });
    try {
      const existing = await d.repository.listForUser(actor.userId);
      if (
        existing.length >= PASSKEY_CREDENTIAL_LIMIT &&
        !(await this.isDemoAccount(actor))
      )
        throw new PasskeyLimitError();
      const userName = await d.repository.findLoginForUser(actor.userId);
      if (!userName) throw new Error();
      const options = await d.verifier.registrationOptions({
        userId: actor.userId,
        userName,
        existingCredentials: existing.map((record) => ({
          id: record.credentialId,
          transports: record.transports,
        })),
      });
      await this.requireFreshSession(actor, sessionToken);
      const challengeId = await this.saveChallenge(
        options.challenge,
        "registration",
        actor.userId,
        `passkey-challenge:registration:user:${d.tokens.hash(actor.userId)}`,
        PASSKEY_REGISTRATION_ISSUANCE_LIMIT,
      );
      return { challengeId, options };
    } finally {
      await reservation.release();
    }
  }

  async register(actor: Actor, input: unknown, sessionToken?: string) {
    requirePasskeyActor(actor);
    const d = this.deps;
    await this.requireFreshSession(actor, sessionToken);
    const parsed = parsePasskeyRegistration(
      input,
      (await this.isDemoAccount(actor)) ? DEMO_PASSKEY_DEVICE_NAME : undefined,
    );
    try {
      const challenge = await d.repository.consumeChallenge(
        parsed.challengeId,
        "registration",
        actor.userId,
        d.clock.now(),
      );
      if (!challenge) throw new Error();
      const result = await d.verifier.verifyRegistration({
        response: parsed.response,
        expectedChallengeHash: challenge.challengeHash,
      });
      if (
        !result.verified ||
        result.credential.id !== parsed.response.id ||
        !Number.isInteger(result.credential.counter) ||
        result.credential.counter < 0 ||
        result.credential.counter > 0xffff_ffff
      )
        throw new Error();
      await this.requireFreshSession(actor, sessionToken);
      const reservation = await d.limiter.reserve([
        {
          key: `passkey-registration-success:user-ip:${d.tokens.hash(`${actor.userId}:${parsed.ip}`)}`,
          limit: PASSKEY_REGISTRATION_SUCCESS_LIMIT,
          windowSec: PASSKEY_REGISTRATION_SUCCESS_WINDOW_SEC,
        },
      ]);
      if (!reservation) throw new PasskeyRegistrationRateLimitedError();
      try {
        await this.requireFreshSession(actor, sessionToken);
        const created = await d.repository.create({
          id: d.ids.next(),
          userId: actor.userId,
          credentialId: result.credential.id,
          publicKey: result.credential.publicKey,
          counter: result.credential.counter,
          transports: result.credential.transports ?? [],
          deviceName: parsed.deviceName,
          createdAt: d.clock.now().toISOString(),
          lastUsedAt: null,
        });
        if (!created) throw new PasskeyLimitError();
      } catch (error) {
        await reservation.release();
        throw error;
      }
      // Keep this reservation to count completed registrations in the window.
      await reservation.commitFailure();
    } catch (error) {
      if (
        error instanceof PasskeyReauthenticationRequiredError ||
        error instanceof PasskeyLimitError ||
        error instanceof PasskeyRegistrationRateLimitedError
      )
        throw error;
      d.logger.warn("passkey_registration_failed", {
        code: "PASSKEY_REGISTRATION_FAILED",
      });
      throw new ValidationError({ passkey: [PASSKEY_REGISTRATION_MESSAGE] });
    }
  }

  async authenticationOptions(input: unknown) {
    const d = this.deps;
    try {
      const ip = parsePasskeyIp(input);
      const reservation = await d.limiter.reserve([
        {
          key: `passkey-options:ip:${d.tokens.hash(ip)}`,
          limit: PASSKEY_AUTHENTICATION_OPTIONS_LIMIT,
          windowSec: LOGIN_WINDOW_SEC,
        },
      ]);
      if (!reservation) throw new Error();
      try {
        const options = await d.verifier.authenticationOptions({
          credentials: [],
        });
        const challengeId = await this.saveChallenge(
          options.challenge,
          "authentication",
          null,
          `passkey-challenge:authentication:ip:${d.tokens.hash(ip)}`,
          ip === "unknown"
            ? PASSKEY_AUTHENTICATION_UNKNOWN_ISSUANCE_LIMIT
            : PASSKEY_AUTHENTICATION_ISSUANCE_LIMIT,
        );
        return { challengeId, options };
      } finally {
        await reservation.release();
      }
    } catch {
      d.logger.warn("passkey_login_failed", { code: "PASSKEY_LOGIN_FAILED" });
      throw loginError();
    }
  }

  async authenticate(input: unknown, previousToken?: string) {
    const d = this.deps;
    try {
      const ip = parsePasskeyAuthenticationIp(input);
      const reservation = await d.limiter.reserve([
        {
          key: `ip:${d.tokens.hash(ip)}`,
          limit: LOGIN_LIMITS.ip,
          windowSec: LOGIN_WINDOW_SEC,
        },
      ]);
      if (!reservation) throw new Error();
      try {
        const parsed = parsePasskeyAuthentication(input);
        const challenge = await d.repository.consumeChallenge(
          parsed.challengeId,
          "authentication",
          null,
          d.clock.now(),
        );
        if (!challenge) throw new Error();
        const credential = await d.repository.findByCredentialId(
          parsed.response.id,
        );
        if (!credential) throw new Error();
        const result = await d.verifier.verifyAuthentication({
          response: parsed.response,
          expectedChallengeHash: challenge.challengeHash,
          credential: {
            id: credential.credentialId,
            publicKey: credential.publicKey,
            counter: credential.counter,
            transports: credential.transports,
          },
        });
        if (
          !result.verified ||
          result.credentialId !== credential.credentialId ||
          !Number.isInteger(result.newCounter) ||
          result.newCounter < 0 ||
          result.newCounter > 0xffff_ffff
        )
          throw new Error();
        if (
          result.newCounter <= credential.counter &&
          !(result.newCounter === 0 && credential.counter === 0)
        ) {
          d.logger.warn("passkey_counter_regression", {
            code: "PASSKEY_COUNTER_REGRESSION",
          });
          throw new Error();
        }
        const actor = await d.users.findActorByUserId(credential.userId);
        if (!actor) throw new Error();
        requirePasskeyActor(actor);
        const updated = await d.repository.updateCounter(
          credential.id,
          actor.userId,
          credential.counter,
          result.newCounter,
          d.clock.now(),
        );
        if (!updated) throw new Error();
        const session = await createLoginSession(d, actor, previousToken);
        await reservation.release();
        return session;
      } catch (error) {
        await reservation.commitFailure();
        throw error;
      }
    } catch {
      d.logger.warn("passkey_login_failed", { code: "PASSKEY_LOGIN_FAILED" });
      throw loginError();
    }
  }
}
