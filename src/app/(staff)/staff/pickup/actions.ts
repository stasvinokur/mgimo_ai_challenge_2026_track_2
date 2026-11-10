"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { requireStaff } from "@/app/_lib/get-actor";
import { mapActionError } from "@/app/_lib/map-errors";
import { requirePickupOrigin } from "@/app/(student)/requests/pickup-origin";
import { NotFoundError } from "@/application/shared/errors";
import { notifications, staff } from "@/composition/container";

export async function changePickupAction(input: unknown) {
  const actor = await requireStaff();
  try {
    await requirePickupOrigin();
    const result = await staff.changePickup.execute(actor, input);
    after(() =>
      notifications.push.dispatch.executeForRequest(actor, result.requestId),
    );
    revalidatePath("/staff/pickup");
    revalidatePath("/staff/requests");
    revalidatePath(`/staff/requests/${result.requestId}`);
    revalidatePath(`/requests/${result.requestId}`);
    revalidatePath("/today");
    return { ok: true as const };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    return mapActionError(error);
  }
}
