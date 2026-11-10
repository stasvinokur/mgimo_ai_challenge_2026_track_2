import type { Metadata } from "next";
import { requireStaff } from "@/app/_lib/get-actor";
import { mapPageError } from "@/app/_lib/map-errors";
import { EVENT_RELEASE_TYPE } from "@/application/requests/schemas";
import { requests, staff } from "@/composition/container";
import { StaffRequestDetail } from "@/ui/staff/detail";
import { changeStaffRequestStatusAction } from "../actions";

export const metadata: Metadata = { title: "Заявка студента" };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireStaff();
  const request = await staff.getRequest
    .execute(actor, await params)
    .catch(mapPageError);
  const eventReleaseBasis =
    request.type.code === EVENT_RELEASE_TYPE
      ? await requests.getEventReleaseBasis.execute(actor).catch(mapPageError)
      : null;
  return (
    <StaffRequestDetail
      request={request}
      eventReleaseBasis={eventReleaseBasis}
      change={changeStaffRequestStatusAction}
    />
  );
}
