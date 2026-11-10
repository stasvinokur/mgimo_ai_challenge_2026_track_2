import type { Metadata } from "next";
import Link from "next/link";
import { requireStudent } from "@/app/_lib/get-actor";
import { mapPageError } from "@/app/_lib/map-errors";
import { grades } from "@/composition/container";
import { CourseDetails } from "@/ui/grades/course-card";
import { ScoreHistory } from "@/ui/grades/score-history";
import { gradesMessages } from "@/ui/i18n/dictionaries/grades";
import { getLanguage } from "@/ui/i18n/server";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";

export async function generateMetadata(): Promise<Metadata> {
  await requireStudent();
  return { title: t(await getLanguage(), gradesMessages, "coursePageTitle") };
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ actions?: string; workId?: string | string[] }>;
}) {
  const actor = await requireStudent();
  const query = await searchParams;
  const { courseId } = await params;
  const data = await grades.getCourseGrades
    .execute(actor, { courseId })
    .catch(mapPageError);
  const workId = data.course.works.find((work) => work.id === query.workId)?.id;
  const semester = await grades.getMyGrades
    .executeMessages(actor)
    .catch(mapPageError);
  const history = await grades.getScoreHistory
    .execute(actor, { courseId })
    .catch(mapPageError);
  const plan = await grades.getCourseActions
    .execute(actor, {
      courseId,
      ...(workId ? { workId } : {}),
    })
    .catch(mapPageError);
  const language = await getLanguage();
  return (
    <div className="section-page">
      <h1>{data.course.title}</h1>
      <Button asChild variant="outline">
        <Link href="/grades">{t(language, gradesMessages, "allCourses")}</Link>
      </Button>
      <CourseDetails
        course={data.course}
        target={data.targetScore}
        semester={semester}
        plan={plan}
        expandedActions={query.actions === "1"}
      />
      <ScoreHistory entries={history.entries} />
    </div>
  );
}
