import type { Metadata } from "next";
import { requireTeacher } from "@/app/_lib/get-actor";
import { attendance } from "@/composition/container";
import { AttendanceTeacherLessons } from "@/ui/attendance/teacher-lessons";

export const metadata: Metadata = { title: "Мои пары" };

export default async function Page() {
  const actor = await requireTeacher();
  const data = await attendance.getLessons.execute(actor);
  return <AttendanceTeacherLessons data={data} />;
}
