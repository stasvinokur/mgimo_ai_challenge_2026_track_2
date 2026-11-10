"use client";

import Link from "next/link";
import type { EventReleaseBasis } from "@/application/requests/event-release-basis";
import { formatRequestFieldValue } from "@/application/requests/format";
import { staffActions } from "@/application/staff/dto";
import type { StaffDetailDto } from "@/application/staff/queries";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitives/card";
import { EventLessonList } from "@/ui/requests/event-lessons";
import { deliveryLabels, formatRequestDate } from "@/ui/requests/format";
import { RequestStatusBadge } from "@/ui/requests/request-status";
import { RequestTimeline } from "@/ui/requests/request-timeline";
import { StaffDeadline } from "./deadline";
import {
  StaffActionButtons,
  type StaffChangeAction,
  useStaffWorkflow,
} from "./workflow";

const auditLabels = Object.fromEntries(
  Object.values(staffActions).map((action) => [action.code, action.label]),
);
export function StaffRequestDetail({
  request,
  change,
  eventReleaseBasis,
}: {
  request: StaffDetailDto;
  change: StaffChangeAction;
  eventReleaseBasis: EventReleaseBasis | null;
}) {
  const workflow = useStaffWorkflow(change, request.demoCommentsOnly);
  return (
    <div className="section-page min-w-0">
      <div>
        <Button variant="ghost" asChild>
          <Link href="/staff/requests">← К очереди заявок</Link>
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-feature border bg-secondary p-6">
        <div>
          <p className="eyebrow">Заявка студента</p>
          <h1 className="font-bold">{request.publicNo}</h1>
          <p className="mt-2 text-muted-foreground">{request.type.title}</p>
        </div>
        <div className="flex flex-col items-start gap-3">
          <RequestStatusBadge status={request.status} />
          <StaffDeadline request={request} />
        </div>
      </div>
      <Card className="rounded-feature">
        <CardHeader>
          <CardTitle>
            <h2>Данные заявки</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">Студент</dt>
              <dd>{request.student.fullName}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Группа</dt>
              <dd>{request.student.group}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Факультет</dt>
              <dd>{request.student.faculty}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Ответственный</dt>
              <dd>{request.assignee ?? "Пока не назначен"}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Ожидаемая дата</dt>
              <dd>
                {request.dueAt ? (
                  <time dateTime={request.dueAt}>
                    {formatRequestDate(request.dueAt, true)}
                  </time>
                ) : (
                  "Уточняется"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Получение</dt>
              <dd>{deliveryLabels[request.type.delivery]}</dd>
            </div>
            {request.type.fields.map((field) => (
              <div key={field.name}>
                <dt className="text-sm text-muted-foreground">{field.title}</dt>
                <dd className="whitespace-pre-wrap break-words">
                  {typeof request.payload[field.name] === "string" &&
                  request.payload[field.name]
                    ? formatRequestFieldValue(
                        field,
                        String(request.payload[field.name]),
                      )
                    : "Не указано"}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <EventLessonList
        audience="staff"
        basis={eventReleaseBasis}
        typeCode={request.type.code}
        payload={request.payload}
        review={request.eventReview}
      />
      <section
        className="space-y-4 rounded-feature border bg-card p-6"
        aria-label="Действия сотрудника"
      >
        <h2>Действия по заявке</h2>
        <StaffActionButtons
          request={request}
          choose={workflow.choose}
          pending={workflow.pending}
        />
        {workflow.feedback}
      </section>
      <RequestTimeline request={request} />
      <Card className="rounded-feature">
        <CardHeader>
          <CardTitle>
            <h2>Журнал действий сотрудников</h2>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Время указано по Москве.
          </p>
        </CardHeader>
        <CardContent>
          {request.audit.length ? (
            <ol className="space-y-3">
              {request.audit.map((entry) => (
                <li
                  key={entry.id}
                  className="space-y-1 rounded-xl border bg-background p-4"
                >
                  <p className="font-medium">
                    {auditLabels[entry.action] ?? "Действие по заявке"}
                  </p>
                  <p className="text-sm">{entry.staffName}</p>
                  <time
                    className="text-sm text-muted-foreground"
                    dateTime={entry.at}
                  >
                    {formatRequestDate(entry.at, true)}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">
              Новых действий сотрудников пока нет. Они появятся после обработки
              заявки.
            </p>
          )}
        </CardContent>
      </Card>
      {workflow.dialog}
    </div>
  );
}
