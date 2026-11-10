import { mapRouteError } from "@/app/_lib/map-errors";
import { identity } from "@/composition/container";
import { json, requirePasskeyActor, requirePasskeyOrigin } from "../http";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const actor = await requirePasskeyActor();
    return json(await identity.passkeys.get(actor, (await context.params).id));
  } catch (error) {
    return mapRouteError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const actor = await requirePasskeyActor();
    requirePasskeyOrigin(request);
    await identity.passkeys.remove(actor, (await context.params).id);
    return json({ ok: true });
  } catch (error) {
    return mapRouteError(error);
  }
}
