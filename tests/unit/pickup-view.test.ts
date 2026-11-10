import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { PickupBookingDto } from "@/application/requests/pickup";
import { requestsMessages } from "@/ui/i18n/dictionaries/requests";
import { LanguageProvider } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { PickupCard } from "@/ui/requests/pickup-card";
import { PickupToday } from "@/ui/requests/pickup-today";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const booking: PickupBookingDto = {
  id: "expired-ticket",
  requestId: "own-request",
  windowId: "window",
  windowTitle: "Окно 2",
  slotStartsAt: "2026-11-05T09:00:00.000Z",
  ticketNo: "Б-017",
  status: "no_show",
  canCancel: false,
};

it.each(["ru", "en"] as const)(
  "%s: прошедший талон предлагает новую запись и не обещает вызов или перенос",
  (language) => {
    const cardProps = {
      language,
      children: createElement(PickupCard, {
        requestId: booking.requestId,
        data: {
          eligible: true,
          booking,
          windows: [
            {
              id: booking.windowId,
              title: booking.windowTitle,
              slots: ["2026-11-06T09:00:00.000Z"],
            },
          ],
        },
        book: vi.fn(),
        cancel: vi.fn(),
      }),
    };
    const card = renderToStaticMarkup(
      createElement(LanguageProvider, cardProps),
    );
    expect(card).toContain(t(language, requestsMessages, "pickupExpired"));
    expect(card).toContain(t(language, requestsMessages, "pickupBookAgain"));
    expect(card).toContain("<form");
    expect(card).toContain(booking.ticketNo);
    expect(card).not.toMatch(
      /Вас вызывают|Please go to|Перенести запись|Reschedule/,
    );
    const todayProps = {
      language,
      children: createElement(PickupToday, { bookings: [booking] }),
    };
    const today = renderToStaticMarkup(
      createElement(LanguageProvider, todayProps),
    );
    expect(today).toContain(t(language, requestsMessages, "pickupExpired"));
    expect(today).toContain(`/requests/${booking.requestId}`);
    expect(today).not.toMatch(/Вас вызывают|Please come to/);
  },
);

it("начавшийся сегодня талон сохраняет запрет на новую запись", () => {
  const card = renderToStaticMarkup(
    createElement(PickupCard, {
      requestId: booking.requestId,
      data: {
        eligible: true,
        booking: { ...booking, status: "called" },
        windows: [],
      },
      book: vi.fn(),
      cancel: vi.fn(),
    }),
  );
  expect(card).toContain("Вас вызывают");
  expect(card).not.toContain("<form");
  expect(card).not.toContain(requestsMessages.pickupExpired.ru);
});
