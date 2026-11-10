import { getActor } from "@/app/_lib/get-actor";
import { mapRouteError } from "@/app/_lib/map-errors";
import { notifications } from "@/composition/container";

export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const actor = await getActor();
    if (!actor)
      return Response.json(
        { error: "Требуется вход." },
        { status: 401, headers },
      );
    if (actor.kind !== "student")
      return Response.json({ error: "Нет доступа." }, { status: 403, headers });
    return Response.json(await notifications.getMyPulse.execute(actor), {
      headers,
    });
  } catch (error) {
    const response = mapRouteError(error);
    response.headers.set("Cache-Control", headers["Cache-Control"]);
    return response;
  }
}
