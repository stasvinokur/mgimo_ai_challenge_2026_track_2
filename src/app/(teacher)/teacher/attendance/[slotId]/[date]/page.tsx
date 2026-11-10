import type { Metadata } from "next";
import { requireTeacher } from "@/app/_lib/get-actor";
import { mapPageError } from "@/app/_lib/map-errors";
import { attendance } from "@/composition/container";
import { TeacherAttendance } from "@/ui/attendance/teacher-screen";

export const metadata: Metadata = {
  title: "Посещаемость пары",
  referrer: "no-referrer",
};
export default async function Page({
  params,
}: {
  params: Promise<{ slotId: string; date: string }>;
}) {
  const actor = await requireTeacher();
  const { slotId, date } = await params;
  const lesson = { slotId, occurrenceDate: date };
  const data = await attendance.getTeacherAttendance
    .execute(actor, lesson)
    .catch(mapPageError);
  return <TeacherAttendance initial={data} lessonKey={lesson} />;
}
