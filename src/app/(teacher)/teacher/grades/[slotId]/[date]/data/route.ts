import { requireTeacher } from "@/app/_lib/get-actor";
import { mapRouteError } from "@/app/_lib/map-errors";
import { teacher } from "@/composition/container";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slotId: string; date: string }> },
) {
  const actor = await requireTeacher({ routeHandler: true });
  const { slotId, date } = await params;
  try {
    return Response.json(
      await teacher.getGradebook.execute(actor, {
        slotId,
        occurrenceDate: date,
      }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return mapRouteError(error);
  }
}
