"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { getPickupMessage } from "@/application/requests/messages";
import type { PickupStateDto } from "@/application/requests/pickup";
import { certificatesMessages } from "@/ui/i18n/dictionaries/certificates";
import { requestsMessages } from "@/ui/i18n/dictionaries/requests";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader } from "@/ui/primitives/card";
import {
  pickupDate,
  pickupDay,
  pickupTime,
  pickupWindow,
} from "./pickup-format";
import { requestErrorMessage, requestFieldError } from "./translations";

export type PickupActionResult =
  | { ok: true }
  | {
      ok: false;
      error: {
        code?: string;
        message: string;
        fieldErrors?: Readonly<Record<string, readonly string[]>>;
      };
    };

export function PickupCard({
  requestId,
  data,
  book,
  cancel,
}: {
  requestId: string;
  data: PickupStateDto;
  book(input: unknown): Promise<PickupActionResult>;
  cancel(id: string): Promise<PickupActionResult>;
}) {
  const language = useLanguage();
  const tr = (
    key: keyof typeof certificatesMessages,
    params?: Record<string, string | number>,
  ) => t(language, certificatesMessages, key, params);
  const router = useRouter();
  const id = useId();
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [windowId, setWindowId] = useState("");
  const [day, setDay] = useState("");
  const [slot, setSlot] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, start] = useTransition();
  useEffect(() => setReady(true), []);
  if (!data.eligible && !data.booking) return null;
  const booking = data.booking;
  const expired = booking?.status === "no_show";
  const bookingMessage = booking ? getPickupMessage(booking) : null;
  const availableWindows = data.windows.filter((item) => item.slots.length > 0);
  const selectedWindow =
    availableWindows.find((item) => item.id === windowId) ??
    availableWindows[0];
  const days = [...new Set(selectedWindow?.slots.map(pickupDay) ?? [])];
  const selectedDay = days.includes(day) ? day : days[0];
  const slots =
    selectedWindow?.slots.filter((item) => pickupDay(item) === selectedDay) ??
    [];
  const selectedSlot = slots.includes(slot) ? slot : slots[0];

  function send(action: () => Promise<PickupActionResult>, success: string) {
    start(async () => {
      setError("");
      setNotice("");
      try {
        const result = await action();
        if (!result.ok) {
          setError(
            Object.values(result.error.fieldErrors ?? {})
              .flat()
              .map((code) => requestFieldError(language, code))
              .join(" ") || requestErrorMessage(language, result.error),
          );
          router.refresh();
          return;
        }
        setEditing(false);
        setNotice(success);
        router.refresh();
      } catch {
        setError(tr("failed"));
      }
    });
  }

  return (
    <Card
      className="min-w-0 rounded-feature"
      role="region"
      aria-label={tr("pickup")}
      data-testid="pickup-card"
      data-ready={ready ? "true" : undefined}
    >
      <CardHeader>
        <h2 className="text-lg font-bold">{tr("pickup")}</h2>
        <p className="text-sm text-muted-foreground">{tr("pickupHelp")}</p>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4">
        {booking && (
          <div
            className="space-y-2 rounded-lg bg-secondary p-4"
            data-testid="pickup-ticket"
          >
            <p className="text-xl font-bold">
              {booking.ticketNo} ·{" "}
              {language === "ru"
                ? pickupWindow(booking.windowTitle)
                : booking.windowTitle}{" "}
              · {pickupTime(booking.slotStartsAt, language)}
            </p>
            <p className="text-sm">
              <time dateTime={booking.slotStartsAt}>
                {pickupDate(booking.slotStartsAt, language)}
              </time>{" "}
              · {tr("msk")}
            </p>
            {expired ? (
              <p role="status" className="font-bold">
                {t(language, requestsMessages, "pickupExpired")}
              </p>
            ) : bookingMessage?.code === "pickupCalled" ? (
              <p role="status" className="font-bold text-primary">
                {tr(bookingMessage.code, {
                  ...bookingMessage.params,
                  window:
                    language === "ru"
                      ? pickupWindow(booking.windowTitle)
                      : booking.windowTitle,
                })}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {bookingMessage &&
                  tr(bookingMessage.code, bookingMessage.params)}
              </p>
            )}
            {booking.canCancel && !editing && (
              <div className="flex flex-wrap gap-2 [overflow-wrap:normal]">
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => setEditing(true)}
                >
                  {tr("reschedule")}
                </Button>
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    send(() => cancel(booking.id), tr("cancelled"))
                  }
                >
                  {tr("cancel")}
                </Button>
              </div>
            )}
          </div>
        )}
        {(!booking || expired || (editing && booking.canCancel)) &&
          (data.windows.length && selectedSlot ? (
            <form
              className="min-w-0 space-y-4"
              aria-busy={pending}
              onSubmit={(event) => {
                event.preventDefault();
                if (!selectedWindow || !selectedSlot) return;
                send(
                  () =>
                    book({
                      id: requestId,
                      windowId: selectedWindow.id,
                      slotStartsAt: selectedSlot,
                    }),
                  booking && !expired ? tr("moved") : tr("booked"),
                );
              }}
            >
              <div className="grid min-w-0 gap-4 sm:grid-cols-3">
                <div className="min-w-0 space-y-1">
                  <label
                    htmlFor={`${id}-window`}
                    className="block text-sm font-medium"
                  >
                    {tr("window")}
                  </label>
                  <select
                    id={`${id}-window`}
                    className="min-h-11 w-full min-w-0 rounded-lg border bg-background px-3"
                    value={selectedWindow?.id ?? ""}
                    disabled={pending}
                    onChange={(event) => {
                      setWindowId(event.target.value);
                      setDay("");
                      setSlot("");
                    }}
                  >
                    {availableWindows.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-0 space-y-1">
                  <label
                    htmlFor={`${id}-date`}
                    className="block text-sm font-medium"
                  >
                    {tr("date")}
                  </label>
                  <select
                    id={`${id}-date`}
                    className="min-h-11 w-full min-w-0 rounded-lg border bg-background px-3"
                    value={selectedDay ?? ""}
                    disabled={pending}
                    onChange={(event) => {
                      setDay(event.target.value);
                      setSlot("");
                    }}
                  >
                    {days.map((item) => (
                      <option key={item} value={item}>
                        {pickupDate(`${item}T12:00:00+03:00`, language)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-0 space-y-1">
                  <label
                    htmlFor={`${id}-time`}
                    className="block text-sm font-medium"
                  >
                    {tr("time")}
                  </label>
                  <select
                    id={`${id}-time`}
                    className="min-h-11 w-full min-w-0 rounded-lg border bg-background px-3"
                    value={selectedSlot ?? ""}
                    disabled={pending}
                    onChange={(event) => setSlot(event.target.value)}
                  >
                    {slots.map((item) => (
                      <option key={item} value={item}>
                        {pickupTime(item, language)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 [overflow-wrap:normal]">
                <Button type="submit" disabled={pending}>
                  {pending
                    ? tr("saving")
                    : expired
                      ? t(language, requestsMessages, "pickupBookAgain")
                      : booking
                        ? tr("confirmMove")
                        : tr("book")}
                </Button>
                {editing && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setEditing(false)}
                  >
                    {tr("keep")}
                  </Button>
                )}
              </div>
            </form>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{tr("noSlots")}</p>
              <Button variant="outline" onClick={() => router.refresh()}>
                {tr("refresh")}
              </Button>
            </div>
          ))}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <p role="status" className="text-sm text-muted-foreground empty:hidden">
          {pending ? tr("savingBooking") : notice}
        </p>
      </CardContent>
    </Card>
  );
}
