import type { Metadata } from "next";
import { requireStudent } from "@/app/_lib/get-actor";
import { mapPageError } from "@/app/_lib/map-errors";
import { attendance, grades } from "@/composition/container";
import { StudentAttendance } from "@/ui/attendance/student-summary";
import { GradesView } from "@/ui/grades/grades-view";
import { gradesMessages } from "@/ui/i18n/dictionaries/grades";
import { getLanguage } from "@/ui/i18n/server";
import { t } from "@/ui/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  await requireStudent();
  return { title: t(await getLanguage(), gradesMessages, "study") };
}

export default async function Page() {
  const actor = await requireStudent();
  const data = await grades.getMyGrades
    .executeMessages(actor, {})
    .catch(mapPageError);
  const visits = await attendance.getMyAttendance
    .execute(actor)
    .catch(mapPageError);
  return (
    <GradesView data={data} attendance={<StudentAttendance data={visits} />} />
  );
}
