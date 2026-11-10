import {
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_TOUCH_INTERVAL_MS,
  sessionExpiry,
} from "../../domain/identity/session-policy";
import type { Clock } from "../ports/clock";
import type { SessionStore } from "../ports/session-store";
import type { IdentityRepository, SessionTokens } from "./ports";

export class GetCurrentActor {
  constructor(
    private readonly sessions: SessionStore,
    private readonly users: IdentityRepository,
    private readonly tokens: SessionTokens,
    private readonly clock: Clock,
  ) {}

  async execute(token: string | undefined) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const now = this.clock.now();
    const session = await this.sessions.findValid(this.tokens.hash(token), now);
    if (
      !session ||
      new Date(session.expiresAt).getTime() <= now.getTime() ||
      new Date(session.createdAt).getTime() + SESSION_ABSOLUTE_TTL_MS <=
        now.getTime()
    )
      return null;
    const actor = await this.users.findActorByUserId(session.userId);
    if (!actor) return null;
    const renewed =
      now.getTime() - new Date(session.lastSeenAt).getTime() >=
      SESSION_TOUCH_INTERVAL_MS;
    const expiresAt = renewed
      ? sessionExpiry(now, new Date(session.createdAt)).toISOString()
      : session.expiresAt;
    if (renewed)
      await this.sessions.touch(session.id, now, new Date(expiresAt));
    return { actor, expiresAt, renewed };
  }
}
