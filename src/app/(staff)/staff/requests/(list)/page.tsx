import type { Metadata } from "next";
import { requireStaff } from "@/app/_lib/get-actor";
import { mapPageError } from "@/app/_lib/map-errors";
import { NotFoundError } from "@/application/shared/errors";
import { identity, staff } from "@/composition/container";
import { StaffBoard } from "@/ui/staff/board";
import { changeStaffRequestStatusAction } from "../actions";

export const metadata: Metadata = { title: "Заявки студентов" };
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireStaff();
  const filters = await searchParams;
  const [data, profile] = await Promise.all([
    staff.listRequests.execute(actor, filters),
    identity.getStaffProfile.execute(actor),
  ]).catch(mapPageError);
  const details = await Promise.all(
    data.requests
      .filter((request) => request.status === "needs_info")
      .map(async ({ id }) => {
        const detail = await staff.getRequest
          .execute(actor, { id })
          .catch((error: unknown) => {
            // A request can disappear after the queue snapshot was read.
            if (error instanceof NotFoundError) return null;
            return mapPageError(error);
          });
        return {
          id,
          question: detail
            ? detail.status === "needs_info"
              ? (detail.events.at(-1)?.comment ?? "")
              : ""
            : null,
        };
      }),
  );
  const disappeared = new Set(
    details.filter(({ question }) => question === null).map(({ id }) => id),
  );
  const questions = Object.fromEntries(
    details.flatMap(({ id, question }) =>
      question === null ? [] : [[id, question]],
    ),
  );
  return (
    <StaffBoard
      data={{
        ...data,
        requests: data.requests.filter(({ id }) => !disappeared.has(id)),
      }}
      staffName={profile.fullName}
      at={new Date().toISOString()}
      questions={questions}
      change={changeStaffRequestStatusAction}
    />
  );
}
