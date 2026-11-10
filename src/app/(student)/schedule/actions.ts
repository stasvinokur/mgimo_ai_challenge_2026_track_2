"use server";

import { requireStudent } from "@/app/_lib/get-actor";
import { mapActionError } from "@/app/_lib/map-errors";
import { schedule } from "@/composition/container";
import type { CalendarActionState } from "@/ui/schedule/calendar-subscription";

export async function renewCalendar(
  _previous: CalendarActionState,
  formData: FormData,
): Promise<CalendarActionState> {
  const actor = await requireStudent();
  try {
    const input = Object.fromEntries(
      [...formData].filter(([key]) => !key.startsWith("$ACTION_")),
    );
    return {
      ok: true,
      ...(await schedule.renewCalendarToken.execute(actor, input)),
    };
  } catch (error) {
    const result = mapActionError(error);
    const code = result.error.code;
    return {
      ok: false,
      status: result.status,
      error: {
        code:
          code === "NOT_FOUND" ||
          code === "FORBIDDEN" ||
          code === "VALIDATION" ||
          code === "CONFLICT" ||
          code === "RATE_LIMITED"
            ? code
            : "INTERNAL_ERROR",
      },
    };
  }
}
