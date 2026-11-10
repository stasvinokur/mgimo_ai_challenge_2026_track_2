import type { Actor } from "../ports/actor";
import type { RateLimiter } from "../ports/rate-limiter";
import { ForbiddenError, RateLimitedError } from "../shared/errors";
import { parseSearchInput } from "./schemas";
import type { SearchCabinet } from "./search-cabinet";

export const SUGGESTION_LIMIT = 20;
export const SUGGESTION_WINDOW_SEC = 10;

export class SuggestCabinet {
  constructor(
    private readonly search: Pick<SearchCabinet, "execute">,
    private readonly limiter: RateLimiter,
  ) {}

  async execute(actor: Actor, input: unknown) {
    if (actor.kind !== "student") throw new ForbiddenError();
    const parsed = parseSearchInput(input);
    const reservation = await this.limiter.reserve([
      {
        key: `search-suggest:${actor.userId}`,
        limit: SUGGESTION_LIMIT,
        windowSec: SUGGESTION_WINDOW_SEC,
      },
    ]);
    if (!reservation) throw new RateLimitedError();
    // Keep the atomic reservation for every lookup, including source failures.
    await reservation.commitFailure();
    return this.search.execute(actor, parsed);
  }
}
