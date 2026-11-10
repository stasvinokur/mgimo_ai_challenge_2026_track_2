import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import { ChangeStaffRequestStatus } from "@/application/staff/change-status";
import { ChangeStaffPickup, ListStaffPickup } from "@/application/staff/pickup";
import {
  GetStaffRequest,
  ListStaffRequests,
} from "@/application/staff/queries";
import { getDatabase } from "@/infrastructure/db/client";
import { PostgresPickupRepository } from "@/infrastructure/db/repositories/requests/pickup-repository";
import { DrizzleStaffRequestRepository } from "@/infrastructure/db/repositories/requests/staff-repository";
import { DrizzleStaffUnitOfWork } from "@/infrastructure/db/repositories/requests/staff-unit-of-work";
import * as schema from "@/infrastructure/db/schema";
import type { createSystemModule } from "./system";

export function createStaffModule(
  system: ReturnType<typeof createSystemModule>,
) {
  const repo = new DrizzleStaffRequestRepository(() =>
    drizzle(getDatabase(), { schema }),
  );
  return {
    listPickup: new ListStaffPickup(
      new PostgresPickupRepository(getDatabase),
      system.clock,
    ),
    changePickup: new ChangeStaffPickup(
      new DrizzleStaffUnitOfWork(getDatabase, system.ids),
      system.clock,
      system.ids,
      system.logger,
    ),
    listRequests: new ListStaffRequests(repo, system.clock),
    getRequest: new GetStaffRequest(repo, system.clock),
    changeStatus: new ChangeStaffRequestStatus(
      new DrizzleStaffUnitOfWork(getDatabase, system.ids),
      system.clock,
      system.ids,
      system.logger,
    ),
  };
}
