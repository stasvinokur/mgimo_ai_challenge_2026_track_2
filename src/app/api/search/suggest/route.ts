import { getActor } from "@/app/_lib/get-actor";
import { mapRouteError } from "@/app/_lib/map-errors";
import { searchSuggestions } from "@/composition/modules/search";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const site = request.headers.get("Sec-Fetch-Site");
    if (site !== null && site !== "same-origin")
      return Response.json({ error: "Нет доступа." }, { status: 403, headers });
    const actor = await getActor();
    if (!actor)
      return Response.json(
        { error: "Требуется вход." },
        { status: 401, headers },
      );
    if (actor.kind !== "student")
      return Response.json({ error: "Нет доступа." }, { status: 403, headers });
    const q = new URL(request.url).searchParams.get("q");
    return Response.json(await searchSuggestions.execute(actor, { q }), {
      headers,
    });
  } catch (error) {
    const response = mapRouteError(error);
    response.headers.set("Cache-Control", headers["Cache-Control"]);
    return response;
  }
}
