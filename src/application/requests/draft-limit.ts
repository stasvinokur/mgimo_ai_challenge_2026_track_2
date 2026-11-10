import type { SessionTokens } from "../identity/ports";
import type { Actor } from "../ports/actor";
import type { RateLimiter } from "../ports/rate-limiter";
import { ForbiddenError, RateLimitedError } from "../shared/errors";
import type { RequestRepository } from "./ports";

export const DEMO_DRAFT_CREATIONS_PER_IP = 20;
export const REQUEST_DRAFT_WINDOW_SEC = 15 * 60;
export const REQUEST_DRAFT_KEY_PREFIX = "request-draft";

export class RequestDraftLimit {
  constructor(
    private readonly accounts: Pick<RequestRepository, "isDemoAccount">,
    private readonly limiter: RateLimiter,
    private readonly tokens: Pick<SessionTokens, "hash">,
    private readonly clientIp: () => string | Promise<string>,
  ) {}

  async reserve(actor: Actor, ip?: string) {
    if (actor.kind !== "student") throw new ForbiddenError();
    if (!(await this.accounts.isDemoAccount(actor.userId))) return null;
    const address = ip ?? (await this.clientIp());
    const reservation = await this.limiter.reserve([
      {
        key: `${REQUEST_DRAFT_KEY_PREFIX}:pair:${this.tokens.hash(`${actor.studentId}\0${address}`)}`,
        limit: DEMO_DRAFT_CREATIONS_PER_IP,
        windowSec: REQUEST_DRAFT_WINDOW_SEC,
      },
    ]);
    if (!reservation) throw new RateLimitedError();
    return reservation;
  }
}
