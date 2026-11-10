import { requireStudent } from "@/app/_lib/get-actor";
import { mapRouteError } from "@/app/_lib/map-errors";
import { grades } from "@/composition/container";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const actor = await requireStudent({ routeHandler: true });
  try {
    const data = await grades.getCourseGrades.execute(actor, await params);
    return Response.json(data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return mapRouteError(error);
  }
}
