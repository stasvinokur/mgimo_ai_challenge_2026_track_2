"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { requireStaff } from "@/app/_lib/get-actor";
import { mapActionError } from "@/app/_lib/map-errors";
import { NotFoundError } from "@/application/shared/errors";
import { notifications, staff } from "@/composition/container";

export async function changeStaffRequestStatusAction(input: unknown) {
  const actor = await requireStaff();
  try {
    const result = await staff.changeStatus.execute(actor, input);
    after(() =>
      notifications.push.dispatch.executeForRequest(actor, result.id),
    );
    revalidatePath("/staff/requests");
    revalidatePath(`/staff/requests/${result.id}`);
    revalidatePath("/requests");
    revalidatePath(`/requests/${result.id}`);
    return { ok: true as const };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    return mapActionError(error);
  }
}
