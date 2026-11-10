"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { requireStudent } from "@/app/_lib/get-actor";
import { mapActionError } from "@/app/_lib/map-errors";
import { NotFoundError } from "@/application/shared/errors";
import { requests } from "@/composition/container";
import { requirePickupOrigin } from "./pickup-origin";

function failure(error: unknown) {
  if (error instanceof NotFoundError) notFound();
  return mapActionError(error);
}

function refresh(id: string) {
  revalidatePath(`/requests/${id}`);
  revalidatePath("/today");
  revalidatePath("/staff/pickup");
}

export async function bookPickupAction(input: unknown) {
  const actor = await requireStudent();
  try {
    await requirePickupOrigin();
    const booking = await requests.bookPickup.execute(actor, input);
    refresh(booking.requestId);
    return { ok: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function cancelPickupAction(id: string) {
  const actor = await requireStudent();
  try {
    await requirePickupOrigin();
    const booking = await requests.cancelPickup.execute(actor, { id });
    refresh(booking.requestId);
    return { ok: true as const };
  } catch (error) {
    return failure(error);
  }
}
