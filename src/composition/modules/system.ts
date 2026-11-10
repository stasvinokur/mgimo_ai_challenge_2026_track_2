import "server-only";
import { getEnv } from "@/infrastructure/config/env";
import { isDatabaseAvailable } from "@/infrastructure/db/health";
import { SystemClock } from "@/infrastructure/system/clock";
import { UuidV7Generator } from "@/infrastructure/system/id-generator";
import { createPinoLogger } from "@/infrastructure/system/logger";
import { version } from "../../../package.json";

export function createSystemModule() {
  return {
    clock: new SystemClock(),
    ids: new UuidV7Generator(),
    logger: createPinoLogger(),
    getEnv,
    async getHealth() {
      const available = await isDatabaseAvailable();
      return {
        status: available ? ("ok" as const) : ("unavailable" as const),
        version: getEnv("APP_VERSION") ?? version,
      };
    },
  };
}
