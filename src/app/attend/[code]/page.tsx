import type { Metadata } from "next";
import { requireStudent } from "@/app/_lib/get-actor";
import { mapPageError } from "@/app/_lib/map-errors";
import { attendance } from "@/composition/container";
import { AttendanceConfirmation } from "@/ui/attendance/confirmation";
import { attendanceMessages } from "@/ui/i18n/dictionaries/attendance";
import { getLanguage } from "@/ui/i18n/server";
import { t } from "@/ui/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  await requireStudent();
  return {
    title: t(await getLanguage(), attendanceMessages, "pageTitle"),
    referrer: "no-referrer",
    robots: { index: false, follow: false },
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const actor = await requireStudent();
  const { code } = await params;
  const confirmation = await attendance.getConfirmation
    .execute(actor, { code })
    .catch(mapPageError);
  return <AttendanceConfirmation code={code} confirmation={confirmation} />;
}
