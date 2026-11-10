import "server-only";
import {
  GetCalendar,
  RenewCalendarToken,
} from "@/application/schedule/calendar";
import { GetToday, GetWeek } from "@/application/schedule/get-schedule";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { getDatabase } from "@/infrastructure/db/client";
import {
  PostgresCalendarTokenStore,
  PostgresScheduleRepository,
} from "@/infrastructure/db/repositories/schedule/repository";
import type { createSystemModule } from "./system";

export function createScheduleModule(
  system: ReturnType<typeof createSystemModule>,
) {
  const repository = new PostgresScheduleRepository(getDatabase);
  const store = new PostgresCalendarTokenStore(getDatabase);
  const tokens = new CryptoSessionTokens();
  return {
    getWeek: new GetWeek(repository, system.clock),
    getToday: new GetToday(repository, system.clock),
    renewCalendarToken: new RenewCalendarToken(
      store,
      tokens,
      system.ids,
      repository,
    ),
    getCalendar: new GetCalendar(store, tokens, repository, system.clock),
  };
}
