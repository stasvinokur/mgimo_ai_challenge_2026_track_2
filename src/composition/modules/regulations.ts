import "server-only";
import {
  GetRegulation,
  ListRegulations,
  SearchRegulations,
} from "@/application/regulations/use-cases";
import { getDatabase } from "@/infrastructure/db/client";
import { PostgresRegulations } from "@/infrastructure/db/repositories/regulations/repository";

export function createRegulationsModule() {
  const repository = new PostgresRegulations(getDatabase);
  return {
    list: new ListRegulations(repository),
    get: new GetRegulation(repository),
    search: new SearchRegulations(repository),
  };
}
