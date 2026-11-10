import type { Actor } from "../ports/actor";
import type { RateLimiter } from "../ports/rate-limiter";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
} from "../shared/errors";
import type { TodayDto } from "./get-today";
import type { BriefingSpeechCache } from "./ports";
import { parseBriefingChecksum } from "./schemas";

export const SPEECH_PAIR_LIMIT = 30;
export const SPEECH_USER_LIMIT = 300;
export const SPEECH_WINDOW_SEC = 60;

export class BriefingAudioUnavailable extends Error {
  override readonly name = "BriefingAudioUnavailable";
  constructor() {
    super("Озвучка временно недоступна.");
  }
}

export class GetBriefingAudio {
  constructor(
    private readonly overview: { execute(actor: Actor): Promise<TodayDto> },
    private readonly build: (
      data: TodayDto,
    ) => readonly { visible: string; spoken: string }[],
    private readonly synthesizer: BriefingSpeechCache,
    private readonly limiter: RateLimiter,
    private readonly hash: (value: string) => string,
  ) {}

  get enabled() {
    return this.synthesizer.enabled;
  }

  async execute(
    actor: Actor,
    input: { index: number; checksum: string; ip: string },
  ) {
    if (actor.kind !== "student") throw new ForbiddenError();
    if (!Number.isInteger(input.index) || input.index < 0 || input.index >= 5)
      throw new NotFoundError();
    const checksum = parseBriefingChecksum(input.checksum);
    // Every valid same-origin attempt consumes the visitor's pair quota.
    const reservation = await this.limiter.reserve([
      {
        key: `briefing-speech:pair:${this.hash(`${actor.userId}\0${input.ip}`)}`,
        limit: SPEECH_PAIR_LIMIT,
        windowSec: SPEECH_WINDOW_SEC,
      },
    ]);
    if (!reservation) throw new RateLimitedError();
    await reservation.commitFailure();
    const data = await this.overview.execute(actor);
    const phrase = this.build(data)[input.index];
    if (!phrase) throw new NotFoundError();
    if (this.hash(phrase.visible) !== checksum) throw new ConflictError();
    if (!this.enabled) throw new BriefingAudioUnavailable();
    try {
      return await this.synthesizer.getOrSynthesize(phrase.spoken, async () => {
        const synthesis = await this.limiter.reserve([
          {
            key: `briefing-speech:user:${this.hash(actor.userId)}`,
            limit: SPEECH_USER_LIMIT,
            windowSec: SPEECH_WINDOW_SEC,
          },
        ]);
        if (!synthesis) throw new RateLimitedError();
        await synthesis.commitFailure();
      });
    } catch (error) {
      if (error instanceof RateLimitedError) throw error;
      throw new BriefingAudioUnavailable();
    }
  }
}
