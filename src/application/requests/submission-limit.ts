import type { SessionTokens } from "../identity/ports";
import type { Actor } from "../ports/actor";
import type { RateLimiter } from "../ports/rate-limiter";
import {
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
} from "../shared/errors";
import type { RequestRepository } from "./ports";

export const DEMO_SUBMISSIONS_PER_IP = 20;
export const DEMO_SUBMISSIONS_PER_STUDENT = 200;
export const REQUEST_SUBMISSION_KEY_PREFIX = "request-submission";
export const REQUEST_SUBMISSION_WINDOW_SEC = 24 * 60 * 60;
export const REQUEST_SUBMISSION_STUDENT_WINDOW_SEC = 60 * 60;

export class RequestSubmissionLimit {
  constructor(
    private readonly accounts: Pick<
      RequestRepository,
      "isDemoAccount" | "findByIdForStudent"
    >,
    private readonly limiter: RateLimiter,
    private readonly tokens: Pick<SessionTokens, "hash">,
    private readonly clientIp: () => string | Promise<string>,
  ) {}

  async reserve(actor: Actor, ip?: string, requestId?: string) {
    if (actor.kind !== "student") throw new ForbiddenError();
    // Preserve the owner-scoped 404 even when this visitor has exhausted the quota.
    if (
      requestId &&
      !(await this.accounts.findByIdForStudent(requestId, actor.studentId))
    )
      throw new NotFoundError();
    if (!(await this.accounts.isDemoAccount(actor.userId))) return null;
    const address = ip ?? (await this.clientIp());
    const reservation = await this.limiter.reserve([
      {
        key: `${REQUEST_SUBMISSION_KEY_PREFIX}:pair:${this.tokens.hash(`${actor.studentId}\0${address}`)}`,
        limit: DEMO_SUBMISSIONS_PER_IP,
        windowSec: REQUEST_SUBMISSION_WINDOW_SEC,
      },
      {
        key: `${REQUEST_SUBMISSION_KEY_PREFIX}:student:${this.tokens.hash(actor.studentId)}`,
        limit: DEMO_SUBMISSIONS_PER_STUDENT,
        windowSec: REQUEST_SUBMISSION_STUDENT_WINDOW_SEC,
      },
    ]);
    if (!reservation) throw new RateLimitedError();
    return reservation;
  }
}
