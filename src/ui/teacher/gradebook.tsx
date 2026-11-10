import { BookOpen } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import type { GetTeacherGradebook } from "@/application/teacher/gradebook";
import { Button } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/primitives/empty-state";
import { GradeEntry } from "./grade-entry";
import "./gradebook.css";

export function Gradebook({
  data,
  lesson,
}: {
  data: Awaited<ReturnType<GetTeacherGradebook["execute"]>>;
  lesson: { slotId: string; occurrenceDate: string };
}) {
  return (
    <div className="section-page min-w-0">
      <div>
        <p className="text-sm text-muted-foreground">
          Ведомость · {data.lesson.group}
        </p>
        <h1>{data.lesson.course}</h1>
        <p className="page-lead">
          Выставьте балл за работу. При исправлении укажите причину — студент
          увидит её в истории изменений.
        </p>
      </div>
      <Button
        asChild
        variant="outline"
        className="self-start [overflow-wrap:normal]"
      >
        <Link href="/teacher/grades">Все ведомости</Link>
      </Button>
      {!data.works.length || !data.students.length ? (
        <EmptyState
          icon={BookOpen}
          title={
            !data.works.length
              ? "Работы ещё не добавлены"
              : "В группе пока нет студентов"
          }
          description="Когда появятся работы и список группы, здесь можно будет выставить баллы. Проверьте ведомость позже."
          action={
            <Button asChild variant="outline">
              <Link
                href={`/teacher/grades/${lesson.slotId}/${lesson.occurrenceDate}`}
              >
                Обновить ведомость
              </Link>
            </Button>
          }
        />
      ) : (
        <section
          className="teacher-gradebook-scroll"
          aria-label="Ведомость студентов"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: The wide gradebook needs keyboard scrolling.
          tabIndex={0}
        >
          <table
            className="teacher-gradebook-table"
            style={
              {
                "--gradebook-width": `calc(var(--spacing) * ${(data.works.length + 1) * 52})`,
              } as CSSProperties
            }
          >
            <caption className="sr-only">
              Студенты и баллы за работы · {data.lesson.group}
            </caption>
            <thead>
              <tr>
                <th scope="col">Студент</th>
                {data.works.map((work) => (
                  <th scope="col" key={work.id}>
                    {work.title}
                    <span className="block text-sm font-normal text-muted-foreground">
                      Максимум {work.maxScore}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.students.map((student) => (
                <tr key={student.key}>
                  <th scope="row">
                    <p>{student.fullName}</p>
                    <p className="text-sm font-normal text-muted-foreground">
                      {student.group}
                    </p>
                  </th>
                  {data.works.map((work) => {
                    const entry = student.entries.find(
                      (value) => value.assessmentId === work.id,
                    );
                    if (!entry) return <td key={work.id}>Данные уточняются</td>;
                    return (
                      <td key={work.id}>
                        <p className="teacher-gradebook-mobile-title">
                          {work.title}
                        </p>
                        <GradeEntry
                          lesson={lesson}
                          entryKey={entry.key}
                          studentName={student.fullName}
                          workTitle={work.title}
                          maxScore={work.maxScore}
                          initialScore={entry.score}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
