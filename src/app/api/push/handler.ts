import { getActor, requireStudent } from "@/app/_lib/get-actor";
import { mapRouteError } from "@/app/_lib/map-errors";
import type { Actor } from "@/application/ports/actor";
import { ForbiddenError, ValidationError } from "@/application/shared/errors";
import { notifications } from "@/composition/container";

const headers = { "Cache-Control": "private, no-store" };

export async function pushRoute(
  work: (
    actor: Extract<Actor, { kind: "student" }>,
    input: unknown,
  ) => Promise<unknown>,
  request?: Request,
) {
  try {
    const session = await getActor();
    if (!session)
      return Response.json(
        { error: "Требуется вход." },
        { status: 401, headers },
      );
    if (session.kind !== "student")
      return Response.json({ error: "Нет доступа." }, { status: 403, headers });
    const actor = await requireStudent();
    let input: unknown;
    if (request) {
      const origin = new URL(notifications.push.getAppOrigin()).origin;
      if (request.headers.get("origin") !== origin) throw new ForbiddenError();
      input = await readPushBody(request);
    }
    return Response.json(await work(actor, input), { headers });
  } catch (error) {
    const response = mapRouteError(error);
    response.headers.set("Cache-Control", headers["Cache-Control"]);
    return response;
  }
}

async function readPushBody(request: Request) {
  const invalid = () =>
    new ValidationError({ subscription: ["Проверьте данные подписки."] });
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw invalid();
  if (Number(request.headers.get("content-length")) > 4096) {
    await request.body?.cancel();
    throw invalid();
  }
  const reader = request.body?.getReader();
  if (!reader) throw invalid();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(invalid());
      void reader.cancel();
    }, 5000);
  });
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let body = "";
    let bytes = 0;
    for (;;) {
      const next = await Promise.race([reader.read(), expired]);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 4096) {
        await reader.cancel();
        throw invalid();
      }
      body += decoder.decode(next.value, { stream: true });
    }
    return JSON.parse(body + decoder.decode()) as unknown;
  } catch {
    throw invalid();
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
