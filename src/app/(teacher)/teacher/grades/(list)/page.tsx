import { BookOpen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireTeacher } from "@/app/_lib/get-actor";
import { mapPageError } from "@/app/_lib/map-errors";
import { teacher } from "@/composition/container";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent } from "@/ui/primitives/card";
import { EmptyState } from "@/ui/primitives/empty-state";

export const metadata: Metadata = { title: "Ведомость" };

export default async function Page() {
  const actor = await requireTeacher();
  const { books } = await teacher.listGradebooks
    .execute(actor)
    .catch(mapPageError);
  return (
    <div className="section-page">
      <div>
        <h1>Ведомость</h1>
        <p className="page-lead">
          Ваши дисциплины и группы по расписанию с учётом замен. Выберите
          группу, чтобы выставить баллы.
        </p>
      </div>
      {books.length ? (
        <ul className="grid min-w-0 gap-4 sm:grid-cols-2">
          {books.map((book) => (
            <li
              key={`${book.slotId}:${book.occurrenceDate}`}
              className="min-w-0"
            >
              <Card className="h-full">
                <CardContent className="space-y-4">
                  <div>
                    <h2>{book.course}</h2>
                    <p className="text-sm text-muted-foreground">
                      {book.group}
                    </p>
                  </div>
                  <Button asChild variant="outline">
                    <Link
                      href={`/teacher/grades/${book.slotId}/${book.occurrenceDate}`}
                    >
                      Открыть ведомость
                      <span className="sr-only">
                        {" "}
                        · {book.course}, {book.group}
                      </span>
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={BookOpen}
          title="Ведомостей пока нет"
          description="Когда в расписании появятся ваши занятия, здесь будут дисциплины и группы."
          action={
            <Button asChild variant="outline">
              <Link href="/teacher">Посмотреть расписание</Link>
            </Button>
          }
        />
      )}
    </div>
  );
}
