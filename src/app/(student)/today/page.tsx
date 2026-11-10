import type { Metadata } from "next";
import { requireStudent } from "@/app/_lib/get-actor";
import { mapPageError } from "@/app/_lib/map-errors";
import {
  onboarding,
  requests,
  schedule,
  speech,
  student,
  today,
} from "@/composition/container";
import { todayMessages } from "@/ui/i18n/dictionaries/today";
import { getLanguage } from "@/ui/i18n/server";
import { t } from "@/ui/i18n/translate";
import { TodayView } from "@/ui/today/today-view";

export async function generateMetadata(): Promise<Metadata> {
  await requireStudent();
  return { title: t(await getLanguage(), todayMessages, "today") };
}

export default async function Page() {
  const actor = await requireStudent();
  const language = await getLanguage();
  try {
    const [overview, week, profile, firstSteps, pickup] =
      await Promise.allSettled([
        Promise.resolve().then(() => today.getOverview.execute(actor)),
        Promise.resolve().then(() => schedule.getWeek.execute(actor)),
        Promise.resolve().then(() => student.getMyProfile.execute(actor)),
        Promise.resolve().then(() => onboarding.getMyOnboarding.execute(actor)),
        Promise.resolve().then(() => requests.listMyPickup.execute(actor)),
      ]);
    if (overview.status === "rejected") throw overview.reason;
    return (
      <TodayView
        serverSpeech={speech.enabled}
        language={language}
        data={overview.value}
        week={
          week.status === "fulfilled"
            ? { ok: true, data: week.value }
            : { ok: false }
        }
        profile={
          profile.status === "fulfilled"
            ? { ok: true, data: profile.value }
            : { ok: false }
        }
        onboarding={
          firstSteps.status === "fulfilled"
            ? { ok: true, data: firstSteps.value }
            : { ok: false }
        }
        pickup={
          pickup.status === "fulfilled"
            ? { ok: true, data: pickup.value }
            : { ok: false }
        }
      />
    );
  } catch (error) {
    return mapPageError(error);
  }
}
