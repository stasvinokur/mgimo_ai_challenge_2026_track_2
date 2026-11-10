"use client";

import { Inbox } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import type { StaffQueueCardDto, StaffTarget } from "@/application/staff/dto";
import type { StaffQueueDto } from "@/application/staff/queries";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent } from "@/ui/primitives/card";
import { CounterTile } from "@/ui/primitives/counter-tile";
import { EmptyState } from "@/ui/primitives/empty-state";
import { cn } from "@/ui/primitives/utils";
import { StaffDeadline } from "./deadline";
import { StaffFiltersForm } from "./filters";
import { queueCounts, queuePulse, queueSlaHref } from "./queue-presentation";
import {
  StaffActionButtons,
  type StaffChangeAction,
  useStaffWorkflow,
} from "./workflow";

const columns = [
  { key: "submitted", title: "Поданы", statuses: ["submitted"], targets: [] },
  {
    key: "accepted",
    title: "Приняты",
    statuses: ["accepted"],
    targets: ["accepted"],
  },
  {
    key: "in_progress",
    title: "В работе",
    statuses: ["in_progress"],
    targets: ["in_progress"],
  },
  {
    key: "needs_info",
    title: "Нужна информация",
    statuses: ["needs_info"],
    targets: ["needs_info"],
  },
  { key: "ready", title: "Готовы", statuses: ["ready"], targets: ["ready"] },
  {
    key: "archive",
    title: "Выданы и отклонены за 7 дней",
    statuses: ["issued", "rejected"],
    targets: ["issued", "rejected"],
  },
] as const;
type Column = (typeof columns)[number];

export function StaffBoard({
  data,
  staffName,
  at,
  questions,
  change,
}: {
  data: StaffQueueDto;
  staffName: string;
  at: string;
  questions: Readonly<Record<string, string>>;
  change: StaffChangeAction;
}) {
  const workflow = useStaffWorkflow(change, data.demoCommentsOnly);
  const counts = queueCounts(data.requests);
  const pulse = queuePulse(data.requests);
  const [dragged, setDragged] = useState<Pick<
    StaffQueueCardDto,
    "id" | "status"
  > | null>(null);
  const [dragReady, setDragReady] = useState(false);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const update = () => setDragReady(desktop.matches);
    update();
    desktop.addEventListener("change", update);
    return () => desktop.removeEventListener("change", update);
  }, []);
  const id = useId();
  const source = data.requests.find(
    (r) => r.id === dragged?.id && r.status === dragged.status,
  );
  function target(column: Column): StaffTarget | undefined {
    return column.targets.find((to) => source?.actions.includes(to));
  }
  function cards(column: Column) {
    const rows = data.requests.filter((r) =>
      column.statuses.some((status) => status === r.status),
    );
    return rows.length ? (
      <ul className="space-y-2">
        {rows.map((request) => (
          <li
            key={request.id}
            draggable={
              dragReady && !workflow.pending && !!request.actions.length
            }
            onDragStart={(event) => {
              setDragged({ id: request.id, status: request.status });
              if (event.dataTransfer) {
                event.dataTransfer.setData("text/plain", request.id);
                event.dataTransfer.effectAllowed = "move";
              }
            }}
            onDragEnd={() => setDragged(null)}
            data-request-id={request.id}
            data-sla={request.sla ?? "none"}
            data-status={request.status}
          >
            <Card
              className={cn(
                "min-w-0 gap-0 rounded-feature py-0",
                request.sla === "overdue" && "border-destructive",
              )}
            >
              <CardContent className="space-y-1 px-3 py-2 last:pb-2">
                <Link
                  className="inline-flex min-h-11 items-center text-sm font-bold text-primary underline-offset-4 hover:underline"
                  href={`/staff/requests/${request.id}`}
                >
                  <span className="sr-only">Открыть заявку </span>
                  {request.publicNo}
                </Link>
                <p className="text-sm font-semibold leading-snug">
                  {request.type.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {request.student.fullName} · {request.student.group}
                </p>
                <StaffDeadline request={request} />
                {request.status === "needs_info" && questions[request.id] && (
                  <blockquote className="rounded-xl bg-background p-3 text-sm whitespace-pre-wrap break-words">
                    <span className="sr-only">Вопрос студенту: </span>
                    {questions[request.id]}
                  </blockquote>
                )}
                <StaffActionButtons
                  request={request}
                  choose={workflow.choose}
                  pending={workflow.pending}
                />
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    ) : (
      <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        Заявок в этом статусе нет. Выберите другой статус или измените фильтры.
      </p>
    );
  }
  function count(column: Column) {
    return data.requests.filter((r) =>
      column.statuses.some((status) => status === r.status),
    ).length;
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-muted-foreground">
            <time dateTime={at}>
              {new Intl.DateTimeFormat("ru-RU", {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone: "Europe/Moscow",
              }).format(new Date(at))}
            </time>
            {" · "}
            {staffName}
          </p>
          <h1 className="mt-1 font-bold">Заявки студентов</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Очередь ваших факультетов. Сначала — заявки, которым нужно внимание
            по сроку.
          </p>
        </div>
        <div className="flex w-full items-center justify-between gap-3 sm:w-auto">
          <div
            aria-hidden="true"
            className="w-32 shrink-0 text-primary sm:w-48"
          >
            <svg
              viewBox="0 0 240 84"
              className="w-full"
              aria-hidden="true"
              focusable="false"
            >
              <polyline
                points={pulse.points.map(({ x, y }) => `${x},${y}`).join(" ")}
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {pulse.overdue.map((point) => (
                <circle
                  key={point.id}
                  cx={point.x}
                  cy={point.y}
                  r="4"
                  className="fill-destructive"
                />
              ))}
            </svg>
          </div>
          <Button variant="outline" className="rounded-xl" asChild>
            <Link href="/staff/profile">Мой профиль</Link>
          </Button>
        </div>
      </div>
      <StaffFiltersForm
        key={JSON.stringify(data.filters)}
        filters={data.filters}
        types={data.types}
      />
      <section
        aria-label="Сроки очереди"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <CounterTile
          className="p-3! [&>strong]:text-3xl!"
          value={counts.overdue}
          label="Просрочено"
          tone="danger"
          href={queueSlaHref(data.filters, "overdue")}
        />
        <CounterTile
          className="p-3! [&>strong]:text-3xl!"
          value={counts.soon}
          label="Срок скоро"
          tone="warning"
          href={queueSlaHref(data.filters, "soon")}
        />
        <CounterTile
          className="p-3! [&>strong]:text-3xl!"
          value={counts.on_time}
          label="В срок"
          tone="success"
          href={queueSlaHref(data.filters, "on_time")}
        />
        <CounterTile
          className="p-3! [&>strong]:text-3xl!"
          value={counts.needs_info}
          label="Ждём студента"
          tone="info"
        />
      </section>
      {workflow.feedback}
      {!data.requests.length && (
        <EmptyState
          icon={Inbox}
          title="Заявок по выбранным условиям нет"
          description="Сбросьте фильтры или вернитесь позже: новые обращения появятся здесь."
          action={
            <Button asChild variant="outline">
              <Link href="/staff/requests">Показать все заявки</Link>
            </Button>
          }
        />
      )}
      <nav
        aria-label="Статусы заявок"
        className="grid grid-cols-2 gap-2 lg:hidden"
      >
        {columns.map((column) => (
          <a
            key={column.key}
            href={`#${id}-column-${column.key}`}
            className="flex min-h-11 items-center rounded-xl border bg-card px-3 py-2 text-sm"
          >
            {column.title} · {count(column)}
          </a>
        ))}
      </nav>
      <section className="w-full min-w-0 pb-4" aria-label="Канбан заявок">
        <p className="mb-3 text-xs text-muted-foreground">
          Меняйте статус кнопками на карточке. На компьютере можно перетащить
          карточку в подсвеченную колонку. Остальные статусы — ниже по странице.
        </p>
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
          {columns.map((column) => (
            <section
              key={column.key}
              className={cn(
                "min-w-0 space-y-2 rounded-feature",
                target(column) &&
                  "border-primary bg-secondary ring-2 ring-primary",
              )}
              aria-labelledby={`${id}-column-${column.key}`}
              data-column={column.key}
              onDragOver={(event) => {
                if (!workflow.pending && target(column)) {
                  event.preventDefault();
                  if (event.dataTransfer)
                    event.dataTransfer.dropEffect = "move";
                }
              }}
              onDrop={(event) => {
                const to = target(column);
                if (
                  source &&
                  to &&
                  !workflow.pending &&
                  event.dataTransfer?.getData("text/plain") === source.id
                ) {
                  event.preventDefault();
                  workflow.choose(source, to);
                }
                setDragged(null);
              }}
            >
              {column.key === "archive" ? (
                <details>
                  <summary
                    id={`${id}-column-${column.key}`}
                    className="min-h-11 cursor-pointer text-sm font-bold"
                  >
                    {column.title} · {count(column)}
                  </summary>
                  <div className="mt-4">{cards(column)}</div>
                </details>
              ) : (
                <>
                  <h2
                    id={`${id}-column-${column.key}`}
                    className="flex min-h-8 scroll-mt-4 items-center justify-between gap-2 text-sm font-bold"
                  >
                    <span>{column.title}</span>
                    <span className="text-muted-foreground">
                      {count(column)}
                    </span>
                  </h2>
                  {cards(column)}
                </>
              )}
            </section>
          ))}
        </div>
      </section>
      {workflow.dialog}
    </div>
  );
}
