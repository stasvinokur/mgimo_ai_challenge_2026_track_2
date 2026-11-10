import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import { headers } from "next/headers";
import {
  ChangeRequestStatus,
  SubmitRequest,
} from "@/application/requests/change-request-status";
import { RequestDraftLimit } from "@/application/requests/draft-limit";
import {
  CreateRequestDraft,
  DeleteRequestDraft,
  UpdateRequestDraft,
} from "@/application/requests/drafts";
import { PreviewEventRelease } from "@/application/requests/event-release";
import { GetEventReleaseBasis } from "@/application/requests/event-release-basis";
import {
  BookRequestPickup,
  CancelRequestPickup,
  GetRequestPickup,
  ListMyPickup,
} from "@/application/requests/pickup";
import {
  CheckRequestPayload,
  GetMyRequest,
  GetRequestCatalog,
  ListMyRequests,
} from "@/application/requests/queries";
import { RequestSubmissionLimit } from "@/application/requests/submission-limit";
import { getClientIp } from "@/infrastructure/auth/request-ip";
import { CryptoSessionTokens } from "@/infrastructure/auth/session-tokens";
import { getDatabase } from "@/infrastructure/db/client";
import { PostgresRateLimiter } from "@/infrastructure/db/repositories/identity/rate-limiter";
import { PostgresRegulations } from "@/infrastructure/db/repositories/regulations/repository";
import { PostgresPickupRepository } from "@/infrastructure/db/repositories/requests/pickup-repository";
import { DrizzleRequestRepository } from "@/infrastructure/db/repositories/requests/repository";
import { DrizzleRequestsUnitOfWork } from "@/infrastructure/db/repositories/requests/unit-of-work";
import { PostgresScheduleRepository } from "@/infrastructure/db/repositories/schedule/repository";
import * as schema from "@/infrastructure/db/schema";
import type { createSystemModule } from "./system";

export function createRequestsModule(
  system: ReturnType<typeof createSystemModule>,
) {
  const { clock, ids } = system;
  const repo = new DrizzleRequestRepository(() =>
    drizzle(getDatabase(), { schema }),
  );
  const uow = new DrizzleRequestsUnitOfWork(getDatabase, ids);
  const pickup = new PostgresPickupRepository(getDatabase);
  const pickupLimiter = new PostgresRateLimiter(getDatabase, clock, ids);
  const schedule = new PostgresScheduleRepository(getDatabase);
  const submissionLimit = new RequestSubmissionLimit(
    repo,
    pickupLimiter,
    new CryptoSessionTokens(),
    async () => getClientIp((await headers()).get("x-forwarded-for")),
  );
  const draftLimit = new RequestDraftLimit(
    repo,
    pickupLimiter,
    new CryptoSessionTokens(),
    async () => getClientIp((await headers()).get("x-forwarded-for")),
  );
  const changeRequestStatus = new ChangeRequestStatus(
    uow,
    clock,
    ids,
    submissionLimit,
  );
  return {
    submissionLimit,
    getPickup: new GetRequestPickup(repo, pickup, clock),
    listMyPickup: new ListMyPickup(pickup, clock),
    bookPickup: new BookRequestPickup(uow, clock, ids, pickupLimiter),
    cancelPickup: new CancelRequestPickup(uow, clock, pickupLimiter),
    previewEvent: new PreviewEventRelease(schedule, clock),
    getEventReleaseBasis: new GetEventReleaseBasis(
      new PostgresRegulations(getDatabase),
    ),
    getCatalog: new GetRequestCatalog(repo),
    listMyRequests: new ListMyRequests(repo, clock),
    getMyRequest: new GetMyRequest(repo, clock),
    checkPayload: new CheckRequestPayload(repo, clock),
    createDraft: new CreateRequestDraft(uow, clock, ids, draftLimit),
    updateDraft: new UpdateRequestDraft(uow, clock),
    deleteDraft: new DeleteRequestDraft(uow),
    submitRequest: new SubmitRequest(changeRequestStatus),
    changeRequestStatus,
  };
}
