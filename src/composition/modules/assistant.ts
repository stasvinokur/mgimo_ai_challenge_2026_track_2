import "server-only";
import { AskAssistant } from "@/application/assistant/ask-assistant";
import { GetMyAssistantJournal } from "@/application/assistant/get-my-journal";
import { SubmitApprovedDraft } from "@/application/assistant/submit-approved";
import { AiSdkAssistantRuntime } from "@/infrastructure/ai/ai-sdk-runtime";
import { MemoryAssistantConversations } from "@/infrastructure/ai/conversations";
import { getClientIp } from "@/infrastructure/auth/request-ip";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { getDatabase } from "@/infrastructure/db/client";
import { PostgresAssistantJournal } from "@/infrastructure/db/repositories/assistant/journal";
import { PostgresRateLimiter } from "@/infrastructure/db/repositories/identity/rate-limiter";
import { DrizzleRequestsUnitOfWork } from "@/infrastructure/db/repositories/requests/unit-of-work";
import { createGradesModule } from "./grades";
import { createRegulationsModule } from "./regulations";
import { createRequestsModule } from "./requests";
import { createScheduleModule } from "./schedule";
import { createSystemModule } from "./system";

export function createAssistantModule() {
  const system = createSystemModule();
  const journal = new PostgresAssistantJournal(
    getDatabase,
    system.clock,
    system.ids,
  );
  const regulations = createRegulationsModule();
  const requests = createRequestsModule(system);
  return {
    getMyJournal: new GetMyAssistantJournal(
      journal,
      regulations.get,
      system.clock,
      new CryptoSessionTokens(),
    ),
    getAppOrigin: () =>
      process.env.APP_ORIGIN ? system.getEnv("APP_ORIGIN") : undefined,
    getClientIp,
    askAssistant: new AskAssistant({
      ...system,
      schedule: createScheduleModule(system),
      grades: createGradesModule(system),
      requests,
      regulations,
      submit: new SubmitApprovedDraft(
        new DrizzleRequestsUnitOfWork(getDatabase, system.ids),
        system.clock,
        system.ids,
        requests.submissionLimit,
      ),
      runtime: new AiSdkAssistantRuntime(undefined, undefined, system.logger),
      tokens: new CryptoSessionTokens(),
      conversations: new MemoryAssistantConversations(system.clock),
      journal,
      limiter: new PostgresRateLimiter(getDatabase, system.clock, system.ids),
    }),
  };
}

export const assistant = createAssistantModule();
