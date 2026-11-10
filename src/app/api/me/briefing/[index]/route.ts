import { getActor } from "@/app/_lib/get-actor";
import { mapRouteError } from "@/app/_lib/map-errors";
import { BriefingAudioUnavailable } from "@/application/today/briefing-audio";
import { speech } from "@/composition/container";

export async function GET(
  request: Request,
  context: { params: Promise<{ index: string }> },
) {
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  const errorResponse = (status: number, error: string) =>
    Response.json({ error }, { status, headers });
  try {
    const actor = await getActor();
    if (!actor) return errorResponse(401, "Требуется вход.");
    if (actor.kind !== "student") return errorResponse(403, "Нет доступа.");
    if (request.headers.get("Sec-Fetch-Site") !== "same-origin")
      return errorResponse(403, "Запрос должен быть отправлен из кабинета.");
    const { index } = await context.params;
    const params = new URL(request.url).searchParams;
    if (
      [...params.keys()].some((key) => key !== "checksum") ||
      params.getAll("checksum").length !== 1
    )
      return errorResponse(400, "Допустима только контрольная сумма фразы.");
    if (!/^[0-4]$/.test(index)) return errorResponse(404, "Фраза не найдена.");
    const value = await speech.getAudio.execute(actor, {
      index: Number(index),
      checksum: params.get("checksum") ?? "",
      ip: speech.clientIp(request),
    });
    return new Response(new Uint8Array(value.audio), {
      headers: { ...headers, "Content-Type": value.contentType },
    });
  } catch (error) {
    if (error instanceof BriefingAudioUnavailable)
      return errorResponse(503, error.message);
    const response = mapRouteError(error);
    for (const [key, value] of Object.entries(headers))
      response.headers.set(key, value);
    return response;
  }
}
