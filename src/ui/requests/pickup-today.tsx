"use client";

import Link from "next/link";
import type { PickupBookingDto } from "@/application/requests/pickup";
import { requestsMessages } from "@/ui/i18n/dictionaries/requests";
import { pickupTodayMessages } from "@/ui/i18n/dictionaries/today";
import { formatDate } from "@/ui/i18n/format";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { pickupWindow } from "./pickup-format";

export function PickupToday({
  bookings,
  className,
}: {
  bookings: PickupBookingDto[];
  className?: string;
}) {
  const language = useLanguage();
  if (!bookings.length) return null;
  return (
    <ul
      className={`space-y-2 ${className ?? ""}`}
      aria-label={t(language, pickupTodayMessages, "tickets")}
    >
      {bookings.map((booking) => (
        <li key={booking.id}>
          <Link
            href={`/requests/${booking.requestId}`}
            className="block min-h-11 space-y-1 rounded-lg bg-secondary p-3"
            data-testid="today-pickup-ticket"
          >
            <span className="block font-bold">
              {booking.ticketNo} ·{" "}
              {language === "ru"
                ? pickupWindow(booking.windowTitle)
                : booking.windowTitle}{" "}
              ·{" "}
              {formatDate(language, booking.slotStartsAt, {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span className="block text-sm">
              {formatDate(language, booking.slotStartsAt, {
                day: "numeric",
                month: "long",
                weekday: "short",
              })}{" "}
              · {t(language, pickupTodayMessages, "zone")}
            </span>
            {booking.status === "no_show" ? (
              <span className="block text-sm font-bold">
                {t(language, requestsMessages, "pickupExpired")}
              </span>
            ) : booking.status === "called" ? (
              <span className="block text-sm font-bold text-primary">
                {t(language, pickupTodayMessages, "called", {
                  window:
                    language === "ru"
                      ? pickupWindow(booking.windowTitle)
                      : booking.windowTitle,
                })}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
