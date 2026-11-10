import { sessionExpiry } from "../../domain/identity/session-policy";
import type { Actor } from "../ports/actor";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { Logger } from "../ports/logger";
import type { SessionStore } from "../ports/session-store";
import type { SessionTokens } from "./ports";

export interface LoginSessionDependencies {
  sessions: SessionStore;
  tokens: SessionTokens;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
}

export async function createLoginSession(
  d: LoginSessionDependencies,
  actor: Actor,
  previousToken?: string,
) {
  const now = d.clock.now();
  const token = d.tokens.generate();
  const expiresAt = sessionExpiry(now).toISOString();
  const previous =
    previousToken && /^[A-Za-z0-9_-]{43}$/.test(previousToken)
      ? await d.sessions.findValid(d.tokens.hash(previousToken), now)
      : null;
  const id = d.ids.next();
  await d.sessions.create({
    id,
    userId: actor.userId,
    tokenHash: d.tokens.hash(token),
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt,
  });
  try {
    if (previous) await d.sessions.revoke(previous.id);
  } catch (error) {
    await d.sessions.revoke(id);
    throw error;
  }
  d.logger.info("login_succeeded", { user_id: actor.userId });
  return { token, expiresAt, kind: actor.kind };
}
