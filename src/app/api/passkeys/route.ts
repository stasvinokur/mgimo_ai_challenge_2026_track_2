import { mapRouteError } from "@/app/_lib/map-errors";
import { identity } from "@/composition/container";
import { json, requirePasskeyActor } from "./http";

export async function GET() {
  try {
    const actor = await requirePasskeyActor();
    return json({
      credentials: await identity.passkeys.list(actor),
      isDemoAccount: await identity.passkeys.isDemoAccount(actor),
    });
  } catch (error) {
    return mapRouteError(error);
  }
}
