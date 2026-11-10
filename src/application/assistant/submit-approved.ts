import type { Actor } from "../ports/actor";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { UnitOfWork } from "../ports/unit-of-work";
import {
  ChangeRequestStatus,
  SubmitRequest,
} from "../requests/change-request-status";
import type { RequestTransaction } from "../requests/ports";
import type { RequestSubmissionLimit } from "../requests/submission-limit";
import { ForbiddenError } from "../shared/errors";
import type { ApprovedSubmission, PendingApproval } from "./ports";

export class SubmitApprovedDraft implements ApprovedSubmission {
  constructor(
    private readonly uow: UnitOfWork<RequestTransaction>,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly submissionLimit?: RequestSubmissionLimit,
  ) {}
  async execute(actor: Actor, approval: PendingApproval, ip?: string) {
    if (actor.kind !== "student") throw new ForbiddenError();
    // Reserve before opening the transaction; validate the approved version under its row lock.
    return new SubmitRequest(
      new ChangeRequestStatus(
        this.uow,
        this.clock,
        this.ids,
        this.submissionLimit,
        approval,
      ),
    ).execute(actor, { id: approval.draftId }, ip);
  }
}
