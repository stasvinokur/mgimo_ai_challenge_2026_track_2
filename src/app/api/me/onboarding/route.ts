import { getActor } from "@/app/_lib/get-actor";
import { mapRouteError } from "@/app/_lib/map-errors";
import { isAssistantOriginAllowed } from "@/app/api/assistant/origin";
import { parseOnboardingAction } from "@/application/onboarding/schemas";
import { ForbiddenError, ValidationError } from "@/application/shared/errors";
import { onboarding, system } from "@/composition/container";

const headers = { "Cache-Control": "private, no-store" };

function validateQuery(request: Request) {
  if (new URL(request.url).search)
    throw new ValidationError({ query: ["Параметры не поддерживаются."] });
}

async function studentActor() {
  const actor = await getActor();
  if (actor && actor.kind !== "student") throw new ForbiddenError();
  return actor;
}

function unauthorized() {
  return Response.json({ error: "Требуется вход." }, { status: 401, headers });
}

function failure(error: unknown) {
  const response = mapRouteError(error);
  response.headers.set("Cache-Control", headers["Cache-Control"]);
  return response;
}

export async function GET(request: Request) {
  try {
    const actor = await studentActor();
    if (!actor) return unauthorized();
    validateQuery(request);
    return Response.json(await onboarding.getMyOnboarding.execute(actor), {
      headers,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await studentActor();
    if (!actor) return unauthorized();
    if (
      !isAssistantOriginAllowed(
        request,
        process.env.APP_ORIGIN ? system.getEnv("APP_ORIGIN") : undefined,
      )
    )
      throw new ForbiddenError();
    const site = request.headers.get("sec-fetch-site");
    if (site !== null && site !== "same-origin") throw new ForbiddenError();
    validateQuery(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError({ body: ["Проверьте формат действия."] });
    }
    const input = parseOnboardingAction(body);
    const result =
      "action" in input
        ? await onboarding.hide.execute(actor)
        : await onboarding.completeStep.execute(actor, input);
    return Response.json(result, { headers });
  } catch (error) {
    return failure(error);
  }
}
