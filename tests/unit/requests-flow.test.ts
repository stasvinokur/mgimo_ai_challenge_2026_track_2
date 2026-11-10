import { describe, expect, it } from "vitest";
import {
  type RequestTarget,
  requestStatuses,
  transitionRequest,
} from "@/domain/requests/request-flow";
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
} from "@/domain/shared/errors";

const allowed = {
  student: [
    "draft:submitted",
    "draft:deleted",
    "submitted:cancelled",
    "needs_info:in_progress",
  ],
  staff: [
    "submitted:accepted",
    "submitted:rejected",
    "accepted:in_progress",
    "accepted:rejected",
    "in_progress:needs_info",
    "in_progress:ready",
    "in_progress:rejected",
    "ready:issued",
  ],
};
for (const role of ["student", "staff"] as const)
  describe(role, () => {
    for (const from of requestStatuses)
      for (const to of [...requestStatuses, "deleted"] as RequestTarget[]) {
        it(`${from} → ${to}: ${allowed[role].includes(`${from}:${to}`) ? "разрешено" : "запрещено"}`, () => {
          const operation = () =>
            transitionRequest({
              from,
              to,
              role,
              comment: "Уточнение",
              payloadValid: true,
            });
          if (allowed[role].includes(`${from}:${to}`))
            expect(operation()).toEqual({
              status: to,
              event: { fromStatus: from, toStatus: to, comment: "Уточнение" },
            });
          else
            expect(operation).toThrow(
              allowed[role === "student" ? "staff" : "student"].includes(
                `${from}:${to}`,
              )
                ? ForbiddenError
                : ConflictError,
            );
        });
      }
  });
it.each([
  { from: "needs_info", to: "in_progress", role: "student" },
  { from: "in_progress", to: "needs_info", role: "staff" },
  ...(["submitted", "accepted", "in_progress"] as const).map((from) => ({
    from,
    to: "rejected" as const,
    role: "staff" as const,
  })),
] as const)("$from → $to требует непустого комментария", (input) => {
  for (const comment of [undefined, "", "   "])
    expect(() => transitionRequest({ ...input, comment })).toThrow(
      ValidationError,
    );
});
it("неполную заявку нельзя отправить", () => {
  expect(() =>
    transitionRequest({
      from: "draft",
      to: "submitted",
      role: "student",
      payloadValid: false,
    }),
  ).toThrow(ValidationError);
});
