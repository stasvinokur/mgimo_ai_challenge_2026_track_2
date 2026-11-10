import { getActor } from "@/app/_lib/get-actor";
import { mapRouteError } from "@/app/_lib/map-errors";
import { NotFoundError } from "@/application/shared/errors";
import { schedule } from "@/composition/container";

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  try {
    if (new URL(request.url).search) throw new NotFoundError();
    const { token } = await context.params;
    const calendar = await schedule.getCalendar.execute(
      token,
      await getActor(),
    );
    return new Response(calendar, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="pulse.ics"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const response = mapRouteError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
