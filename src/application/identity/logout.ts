import type { Clock } from "../ports/clock";
import type { Logger } from "../ports/logger";
import type { SessionStore } from "../ports/session-store";
import type { SessionTokens } from "./ports";

export class Logout {
  constructor(
    private readonly sessions: SessionStore,
    private readonly tokens: SessionTokens,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async execute(token: string | undefined): Promise<void> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const session = await this.sessions.findValid(
      this.tokens.hash(token),
      this.clock.now(),
    );
    if (!session) return;
    await this.sessions.revoke(session.id);
    this.logger.info("logout_succeeded", { user_id: session.userId });
  }
}
