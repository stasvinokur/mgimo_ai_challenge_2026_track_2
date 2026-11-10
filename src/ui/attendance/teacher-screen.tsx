"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GetTeacherAttendance,
  IssueAttendanceCode,
} from "@/application/attendance/teacher";
import { appPath } from "@/ui/shared/app-path.mjs";

type LessonKey = { slotId: string; occurrenceDate: string };

import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader } from "@/ui/primitives/card";
import { Skeleton } from "@/ui/primitives/skeleton";

export type TeacherAttendanceData = Awaited<
  ReturnType<GetTeacherAttendance["execute"]>
>;
type Qr = Awaited<ReturnType<IssueAttendanceCode["execute"]>>;
const time = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

export function TeacherAttendance({
  initial,
  lessonKey,
}: {
  initial: TeacherAttendanceData;
  lessonKey: LessonKey;
}) {
  const [data, setData] = useState(initial);
  const [qr, setQr] = useState<Qr | null>(null);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState(false);
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  const endpoint = `/teacher/attendance/${lessonKey.slotId}/${lessonKey.occurrenceDate}/live`;
  const mutate = useCallback(
    async (action: "issue" | "close", previousCode?: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setError("");
      try {
        const response = await fetch(appPath(endpoint), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            ...(previousCode ? { previousCode } : {}),
          }),
          cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error?.message ?? "Не удалось обновить отметку.",
          );
        if (action === "close") {
          setQr(null);
          setNotice(
            "Отметка закрыта. Неотмеченные студенты сохранены как пропустившие занятие.",
          );
        } else {
          setQr(result as Qr);
          setNow(Date.now());
          setNotice("");
        }
      } catch (failure) {
        setQr(null);
        setError(
          failure instanceof Error
            ? failure.message
            : "Проверьте соединение и повторите действие.",
        );
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [endpoint],
  );

  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const response = await fetch(appPath(endpoint), {
          cache: "no-store",
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error("ATTENDANCE_POLL_FAILED");
        if (!controller.signal.aborted) {
          setData(result as TeacherAttendanceData);
          setPollError(false);
        }
      } catch {
        if (!controller.signal.aborted) setPollError(true);
      } finally {
        running = false;
      }
    };
    const timer = setInterval(() => {
      void poll();
    }, 3000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [endpoint]);

  useEffect(() => {
    if (!qr) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const rotation = setTimeout(
      () => {
        void mutate("issue", qr.path.split("/").at(-1));
      },
      Math.max(0, Date.parse(qr.rotateAt) - Date.now()),
    );
    return () => {
      clearInterval(timer);
      clearTimeout(rotation);
    };
  }, [qr, mutate]);
  const occurrences = new Map<string, number>();
  const roster = data.roster.map((student) => {
    const name = JSON.stringify([student.fullName, student.group]);
    const occurrence = occurrences.get(name) ?? 0;
    occurrences.set(name, occurrence + 1);
    return { ...student, rowKey: `${name}:${occurrence}` };
  });
  const liveQr =
    qr && now < Date.parse(qr.expiresAt) && data.windowOpen ? qr : null;

  return (
    <div className="section-page">
      <Link
        className="inline-flex min-h-11 items-center text-primary underline"
        href="/teacher"
      >
        ← Мои пары
      </Link>
      <div>
        <p className="eyebrow">Посещаемость · {data.lesson.group}</p>
        <h1>{data.lesson.course}</h1>
        <p className="text-muted-foreground">
          {time.format(new Date(data.lesson.startsAt))} —{" "}
          {time.format(new Date(data.lesson.endsAt))} МСК · {data.lesson.room}
        </p>
      </div>
      <div className="grid min-w-0 gap-6">
        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold">Экран аудитории</h2>
          </CardHeader>
          <CardContent className="grid min-w-0 justify-items-center gap-4 text-center">
            <p
              role="status"
              className="text-3xl font-semibold tabular-nums md:text-5xl"
            >
              {`Отметились ${data.present}\u00a0из\u00a0${data.total}`}
            </p>
            {pollError && (
              <p role="alert">
                Список временно не обновляется. Повторяем запрос каждые 3
                секунды.{" "}
                <Button
                  variant="outline"
                  onClick={() => window.location.reload()}
                >
                  Обновить страницу
                </Button>
              </p>
            )}
            {busy && !qr && (
              <Skeleton className="aspect-square w-full max-w-2xl" />
            )}
            {liveQr && (
              <>
                <Image
                  src={liveQr.qrImage}
                  unoptimized
                  width={768}
                  height={768}
                  alt="QR-код для отметки на паре. Текстовая ссылка — ниже."
                  className="h-auto w-full max-w-2xl rounded-xl"
                />
                <p className="text-sm text-muted-foreground">
                  Код меняется каждые 20 секунд. Студент подтверждает отметку на
                  своём телефоне.
                </p>
                <a
                  data-testid="attendance-link"
                  href={liveQr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-h-11 max-w-full break-all text-primary underline"
                >
                  {liveQr.url}
                </a>
                <Button
                  variant="outline"
                  className="whitespace-nowrap [overflow-wrap:normal]"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(liveQr.url);
                      setNotice("Ссылка скопирована");
                    } catch {
                      setNotice(
                        "Не удалось скопировать. Выделите ссылку выше.",
                      );
                    }
                  }}
                >
                  Скопировать ссылку
                </Button>
              </>
            )}
            {!data.windowOpen && (
              <p>
                Окно отметки закрыто. Оно доступно от 10 минут до начала и до
                конца действующей пары.
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
            {error && <p role="alert">{error}</p>}
            <div className="flex flex-wrap justify-center gap-3">
              {!qr && data.windowOpen && (
                <Button
                  disabled={busy}
                  onClick={() => void mutate("issue")}
                  className="whitespace-nowrap [overflow-wrap:normal]"
                >
                  {error ? "Открыть снова" : "Открыть отметку"}
                </Button>
              )}
              {data.canClose && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void mutate("close")}
                  className="whitespace-nowrap [overflow-wrap:normal]"
                >
                  Закрыть отметку
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        <details
          className="rounded-xl border border-border bg-card"
          data-testid="attendance-roster"
        >
          <summary className="min-h-11 cursor-pointer p-4 font-semibold [overflow-wrap:normal]">
            Состав группы
          </summary>
          <div className="px-4 pb-4">
            {data.roster.length ? (
              <ul className="divide-y divide-border">
                {roster.map((student) => (
                  <li key={student.rowKey} className="space-y-1 py-3">
                    <p className="font-medium">
                      {student.fullName} · {student.group}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {student.status === "present"
                        ? "Был"
                        : student.status === "excused"
                          ? `Уважительная причина: ${student.reason}`
                          : "Не отмечен"}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                В группе пока нет студентов. Состав появится после добавления
                студентов в расписание.
              </p>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}
