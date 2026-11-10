import { CalendarDays } from "lucide-react";
import { LogoutButton } from "@/app/(auth)/logout-button";
import type { GetMyLessons } from "@/application/teacher/get-my-lessons";
import type { TeacherLesson } from "@/application/teacher/ports";
import { Badge } from "@/ui/primitives/badge";
import { Card, CardContent, CardHeader } from "@/ui/primitives/card";
import { EmptyState } from "@/ui/primitives/empty-state";

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  weekday: "long",
  day: "numeric",
  month: "long",
});
const timeFormat = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  hour: "2-digit",
  minute: "2-digit",
});
const dateLabel = (date: string) =>
  dateFormat.format(new Date(`${date}T12:00:00+03:00`));

function Lessons({ lessons }: { lessons: TeacherLesson[] }) {
  return (
    <ul className="grid gap-3">
      {lessons.map((lesson) => {
        const inactive =
          lesson.status === "moved-from" || lesson.status === "cancelled";
        const destination = lesson.changes.at(-1)?.after;
        return (
          <li
            key={`${lesson.id}:${lesson.status}`}
            data-testid="teacher-lesson"
            data-status={lesson.status}
          >
            <Card>
              <CardHeader className="gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={
                      inactive
                        ? "font-semibold tabular-nums text-muted-foreground line-through"
                        : "font-semibold tabular-nums"
                    }
                  >
                    {timeFormat.format(new Date(lesson.startsAt))}–
                    {timeFormat.format(new Date(lesson.endsAt))}
                  </span>
                  {lesson.status !== "scheduled" && (
                    <Badge
                      variant="secondary"
                      className="max-w-full"
                      style={{ whiteSpace: "normal", overflowWrap: "normal" }}
                    >
                      {lesson.status === "moved-from" && destination
                        ? `Перенесена → ${timeFormat.format(new Date(destination.startsAt))}, ${destination.room}`
                        : {
                            "moved-from": "Перенесена",
                            "moved-to": "Новое время",
                            cancelled: "Отменена",
                          }[lesson.status]}
                    </Badge>
                  )}
                </div>
                <h3
                  className={
                    inactive
                      ? "font-semibold text-muted-foreground line-through"
                      : "font-semibold"
                  }
                >
                  {lesson.course}
                </h3>
              </CardHeader>
              <CardContent
                className={
                  inactive
                    ? "flex flex-col gap-2 text-sm text-muted-foreground"
                    : "flex flex-col gap-2 text-sm"
                }
              >
                <p>
                  {lesson.group} · {lesson.room}
                </p>
                <p className="text-muted-foreground">
                  {lesson.kind === "lecture"
                    ? "Лекция"
                    : lesson.kind === "seminar"
                      ? "Семинар"
                      : "Экзамен"}
                </p>
                {lesson.changes.map((change) => (
                  <p key={change.id}>{change.reason}</p>
                ))}
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

export function MyLessons({
  data,
}: {
  data: Awaited<ReturnType<GetMyLessons["execute"]>>;
}) {
  const activeDays = data.days.filter((day) => day.lessons.length > 0);
  return (
    <div className="section-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Кабинет преподавателя</p>
          <h1>Мои пары</h1>
        </div>
        <LogoutButton language="ru" />
      </div>
      <p className="text-muted-foreground">
        Ваши занятия с учётом изменений. Время московское.
      </p>
      <section className="grid gap-4" aria-labelledby="teacher-today">
        <h2 id="teacher-today" className="text-xl font-semibold">
          Сегодня · {dateLabel(data.today)}
        </h2>
        {data.todayLessons.length ? (
          <Lessons lessons={data.todayLessons} />
        ) : (
          <EmptyState
            icon={CalendarDays}
            title="Сегодня пар нет"
            description="Можно подготовиться к следующей встрече. Ближайшие занятия — ниже, в расписании недели."
            action={
              <a
                href="#teacher-week"
                className="inline-flex min-h-11 items-center font-medium text-primary underline [overflow-wrap:normal]"
              >
                Посмотреть неделю
              </a>
            }
          />
        )}
      </section>
      <section className="grid gap-4" aria-labelledby="teacher-week">
        <h2 id="teacher-week" className="text-xl font-semibold">
          На этой неделе
        </h2>
        {activeDays.length ? (
          activeDays.map((day) => (
            <div key={day.date} className="grid gap-3">
              <p className="font-medium">{dateLabel(day.date)}</p>
              <Lessons lessons={day.lessons} />
            </div>
          ))
        ) : (
          <EmptyState
            icon={CalendarDays}
            title="На этой неделе пар нет"
            description="Когда занятия появятся в расписании, они будут здесь. Можно вернуться к расписанию позже."
            action={
              <a
                href="/teacher"
                className="inline-flex min-h-11 items-center font-medium text-primary underline [overflow-wrap:normal]"
              >
                Обновить расписание
              </a>
            }
          />
        )}
      </section>
    </div>
  );
}
