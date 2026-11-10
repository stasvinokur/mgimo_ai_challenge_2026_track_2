import "server-only";
import { headers } from "next/headers";
import { isAssistantOriginAllowed } from "@/app/api/assistant/origin";
import { attendanceOrigin } from "@/application/attendance/origin";
import { ForbiddenError } from "@/application/shared/errors";
import { system } from "@/composition/container";

export async function requireAttendanceOrigin() {
  const incoming = await headers();
  const origin = attendanceOrigin(
    incoming,
    process.env.APP_ORIGIN ? system.getEnv("APP_ORIGIN") : undefined,
  );
  if (
    !isAssistantOriginAllowed(
      new Request(origin, { headers: incoming }),
      origin,
    )
  )
    throw new ForbiddenError();
}
