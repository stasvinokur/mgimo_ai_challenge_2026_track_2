import { getActor } from "@/app/_lib/get-actor";
import { mapRouteError } from "@/app/_lib/map-errors";
import { certificates } from "@/composition/container";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
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
    const result = await certificates.download.execute(
      actor,
      await context.params,
    );
    const filename = `spravka-${result.number}.pdf`;
    return new Response(new Uint8Array(result.bytes), {
      headers: {
        ...headers,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename.replace(/^spravka-С-/, "spravka-C-")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (error) {
    const response = mapRouteError(error);
    response.headers.set("Cache-Control", headers["Cache-Control"]);
    return response;
  }
}
