import "server-only";
import { GetBriefingAudio } from "@/application/today/briefing-audio";
import type { GetTodayOverview } from "@/application/today/get-today";
import { getClientIp } from "@/infrastructure/auth/request-ip";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { getEnv } from "@/infrastructure/config/env";
import { getDatabase } from "@/infrastructure/db/client";
import { PostgresRateLimiter } from "@/infrastructure/db/repositories/identity/rate-limiter";
import {
  CachedSpeechSynthesizer,
  DisabledSpeechSynthesizer,
  HttpSpeechSynthesizer,
} from "@/infrastructure/tts/synthesizer";
import { buildTodayBriefingForms } from "@/ui/today/briefing";
import type { createSystemModule } from "./system";

export function createSpeechModule(
  overview: GetTodayOverview,
  system: ReturnType<typeof createSystemModule>,
) {
  const tokens = new CryptoSessionTokens();
  let cached: CachedSpeechSynthesizer | undefined;
  const synthesizer = {
    get enabled() {
      return Boolean(getEnv("TTS_URL"));
    },
    getOrSynthesize(text: string, beforeSynthesis: () => Promise<void>) {
      const url = getEnv("TTS_URL");
      cached ??= new CachedSpeechSynthesizer(
        url ? new HttpSpeechSynthesizer(url) : new DisabledSpeechSynthesizer(),
      );
      return cached.getOrSynthesize(text, beforeSynthesis);
    },
  };
  return {
    get enabled() {
      return synthesizer.enabled;
    },
    clientIp: (request: Request) =>
      getClientIp(request.headers.get("x-forwarded-for")),
    getAudio: new GetBriefingAudio(
      overview,
      (data) => buildTodayBriefingForms(data, data.asOf, "ru"),
      synthesizer,
      new PostgresRateLimiter(getDatabase, system.clock, system.ids),
      (value) => tokens.hash(value),
    ),
  };
}
