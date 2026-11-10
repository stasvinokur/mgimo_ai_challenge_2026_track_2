import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import { SearchCabinet } from "@/application/search/search-cabinet";
import { SuggestCabinet } from "@/application/search/suggest-cabinet";
import { getDatabase } from "@/infrastructure/db/client";
import { PostgresGradesRepository } from "@/infrastructure/db/repositories/grades/grades";
import { PostgresRateLimiter } from "@/infrastructure/db/repositories/identity/rate-limiter";
import { PostgresRegulations } from "@/infrastructure/db/repositories/regulations/repository";
import { DrizzleRequestRepository } from "@/infrastructure/db/repositories/requests/repository";
import { PostgresScheduleRepository } from "@/infrastructure/db/repositories/schedule/repository";
import * as schema from "@/infrastructure/db/schema";
import { createSystemModule } from "./system";

const system = createSystemModule();

export const search = new SearchCabinet(
  new PostgresScheduleRepository(getDatabase),
  new PostgresGradesRepository(getDatabase),
  new DrizzleRequestRepository(() => drizzle(getDatabase(), { schema })),
  new PostgresRegulations(getDatabase),
  system.clock,
  system.logger,
);

export const searchSuggestions = new SuggestCabinet(
  search,
  new PostgresRateLimiter(getDatabase, system.clock, system.ids),
);
