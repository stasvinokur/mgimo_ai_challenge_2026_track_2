import type { Metadata } from "next";
import { requireTeacher } from "@/app/_lib/get-actor";
import { mapPageError } from "@/app/_lib/map-errors";
import { teacher } from "@/composition/container";
import { Gradebook } from "@/ui/teacher/gradebook";

export const metadata: Metadata = { title: "Ведомость дисциплины" };

export default async function Page({
  params,
}: {
  params: Promise<{ slotId: string; date: string }>;
}) {
  const actor = await requireTeacher();
  const { slotId, date } = await params;
  const lesson = { slotId, occurrenceDate: date };
  const data = await teacher.getGradebook
    .execute(actor, lesson)
    .catch(mapPageError);
  return <Gradebook data={data} lesson={lesson} />;
}
