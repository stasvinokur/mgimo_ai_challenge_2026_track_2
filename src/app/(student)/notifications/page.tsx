import type { Metadata } from "next";
import { requireStudent } from "@/app/_lib/get-actor";
import { mapPageError } from "@/app/_lib/map-errors";
import { notifications } from "@/composition/container";
import { notificationsMessages } from "@/ui/i18n/dictionaries/notifications";
import { getLanguage } from "@/ui/i18n/server";
import { t } from "@/ui/i18n/translate";
import { NotificationsView } from "@/ui/notifications/notifications-view";
import { readAllNotificationsAction, readNotificationAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  await requireStudent();
  return { title: t(await getLanguage(), notificationsMessages, "title") };
}

export default async function Page() {
  const actor = await requireStudent();
  try {
    const feed = await notifications.getMyNotifications.execute(actor);
    return (
      <NotificationsView
        feed={feed}
        read={readNotificationAction}
        readAll={readAllNotificationsAction}
      />
    );
  } catch (error) {
    return mapPageError(error);
  }
}
