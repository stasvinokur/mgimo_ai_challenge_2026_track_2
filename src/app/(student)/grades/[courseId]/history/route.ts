import { requireStudent } from "@/app/_lib/get-actor";
import { mapRouteError } from "@/app/_lib/map-errors";
import { grades } from "@/composition/container";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const actor = await requireStudent({ routeHandler: true });
  try {
    return Response.json(
      await grades.getScoreHistory.execute(actor, await params),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return mapRouteError(error);
  }
}
