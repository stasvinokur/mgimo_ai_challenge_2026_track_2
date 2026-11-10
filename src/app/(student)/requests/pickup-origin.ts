import "server-only";
import { headers } from "next/headers";
import { isAssistantOriginAllowed } from "@/app/api/assistant/origin";
import { ForbiddenError } from "@/application/shared/errors";
import { system } from "@/composition/container";

export async function requirePickupOrigin() {
  const incoming = await headers();
  if (
    !isAssistantOriginAllowed(
      new Request("http://localhost", { headers: incoming }),
      process.env.APP_ORIGIN ? system.getEnv("APP_ORIGIN") : undefined,
    )
  )
    throw new ForbiddenError();
}
