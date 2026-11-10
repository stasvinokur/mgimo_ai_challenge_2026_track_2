"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { requireStudent } from "@/app/_lib/get-actor";
import { mapActionError } from "@/app/_lib/map-errors";
import { NotFoundError } from "@/application/shared/errors";
import { notifications } from "@/composition/container";

export async function readNotificationAction(input: unknown) {
  const actor = await requireStudent();
  try {
    const result = await notifications.readMyNotification.execute(actor, input);
    revalidatePath("/", "layout");
    return { ok: true as const, ...result };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    return notificationActionError(error);
  }
}

export async function readAllNotificationsAction() {
  const actor = await requireStudent();
  try {
    await notifications.readAllMyNotifications.execute(actor);
    revalidatePath("/", "layout");
    return { ok: true as const };
  } catch (error) {
    return notificationActionError(error);
  }
}

export async function latestNotificationTitleAction(input: unknown) {
  const actor = await requireStudent();
  return notifications.getLatestTitle.execute(actor, input);
}

function notificationActionError(error: unknown) {
  const result = mapActionError(error);
  return {
    ok: false as const,
    status: result.status,
    error: {
      code: result.error.code,
      ...(result.error.fieldErrors
        ? { fieldErrors: result.error.fieldErrors }
        : {}),
    },
  };
}
