"use client";

import { Ticket } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { PickupBookingDto } from "@/application/requests/pickup";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader } from "@/ui/primitives/card";
import { EmptyState } from "@/ui/primitives/empty-state";
import { StatusBadge } from "@/ui/primitives/status-badge";
import type { PickupActionResult } from "@/ui/requests/pickup-card";
import { pickupTime } from "@/ui/requests/pickup-format";

const labels = {
  booked: "Ожидает",
  called: "Вызван",
  served: "Выдано",
  no_show: "Не пришёл",
  cancelled: "Отменён",
} as const;

export function PickupQueue({
  bookings,
  change,
}: {
  bookings: PickupBookingDto[];
  change(input: unknown): Promise<PickupActionResult>;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => setReady(true), []);
  function send(
    booking: PickupBookingDto,
    to: "called" | "served" | "no_show",
  ) {
    start(async () => {
      setError("");
      setNotice("");
      try {
        const result = await change({ id: booking.id, to });
        if (!result.ok) setError(result.error.message);
        else
          setNotice(
            `${booking.ticketNo}: ${to === "called" ? "студент вызван" : labels[to].toLocaleLowerCase("ru-RU")}.`,
          );
        router.refresh();
      } catch {
        setError(
          "Не удалось сохранить действие. Повторите его кнопкой талона.",
        );
      }
    });
  }
  return (
    <section
      aria-label="Талоны на сегодня"
      className="min-w-0 space-y-4"
      data-ready={ready ? "true" : undefined}
    >
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => start(() => router.refresh())}
      >
        {pending ? "Обновляем…" : "Обновить очередь"}
      </Button>
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {pending ? "Сохраняем действие…" : notice}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!bookings.length ? (
        <EmptyState
          icon={Ticket}
          title="На сегодня талонов нет"
          description="Здесь появятся записи студентов ваших факультетов. Обновите очередь позже."
          action={
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => start(() => router.refresh())}
            >
              Проверить новые записи
            </Button>
          }
        />
      ) : (
        <ol className="grid min-w-0 gap-4 md:grid-cols-2">
          {bookings.map((booking) => {
            const active =
              booking.status === "booked" || booking.status === "called";
            return (
              <li key={booking.id} className="min-w-0">
                <Card
                  className="h-full min-w-0 rounded-feature"
                  data-testid="pickup-queue-ticket"
                >
                  <CardHeader className="space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h2 className="text-xl font-bold">{booking.ticketNo}</h2>
                      <StatusBadge
                        tone={
                          booking.status === "served"
                            ? "success"
                            : booking.status === "called"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {labels[booking.status]}
                      </StatusBadge>
                    </div>
                    <p className="font-semibold">
                      {booking.windowTitle} ·{" "}
                      <time dateTime={booking.slotStartsAt}>
                        {pickupTime(booking.slotStartsAt)}
                      </time>{" "}
                      МСК
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Button asChild variant="link" className="px-0">
                      <Link href={`/staff/requests/${booking.requestId}`}>
                        Открыть заявку
                        <span className="sr-only">
                          {" "}
                          талона {booking.ticketNo}
                        </span>
                      </Link>
                    </Button>
                    {active && (
                      <fieldset className="flex flex-wrap gap-2 [overflow-wrap:normal]">
                        <legend className="sr-only">
                          Действия по талону {booking.ticketNo}
                        </legend>
                        {booking.status === "booked" && (
                          <Button
                            disabled={pending}
                            onClick={() => send(booking, "called")}
                          >
                            Вызвать
                          </Button>
                        )}
                        <Button
                          disabled={pending}
                          variant={
                            booking.status === "called" ? "default" : "outline"
                          }
                          onClick={() => send(booking, "served")}
                        >
                          Выдано
                        </Button>
                        <Button
                          disabled={pending}
                          variant="ghost"
                          onClick={() => send(booking, "no_show")}
                        >
                          Не пришёл
                        </Button>
                      </fieldset>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
