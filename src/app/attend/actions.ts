"use server";

import { headers } from "next/headers";

import { requireStudent } from "@/app/_lib/get-actor";
import { mapActionError } from "@/app/_lib/map-errors";
import type { AttendActionState } from "@/application/attendance/student";
import { attendance, identity } from "@/composition/container";
import { requireAttendanceOrigin } from "./origin";

export async function markAttendance(
  code: string,
  _previous: AttendActionState,
  form: FormData,
): Promise<AttendActionState> {
  const actor = await requireStudent();
  try {
    await requireAttendanceOrigin();
    const fields = Object.fromEntries(
      [...form].filter(([key]) => !key.startsWith("$ACTION_")),
    );
    if ("ip" in fields)
      return { result: "invalid", messageCode: "invalidCode" };
    return await attendance.markAttendance.execute(actor, {
      ...fields,
      code,
      ip: identity.getClientIp((await headers()).get("x-forwarded-for")),
    });
  } catch (error) {
    const { status } = mapActionError(error);
    return {
      result: "error",
      messageCode:
        status === 403
          ? "forbidden"
          : status === 429
            ? "rateLimited"
            : status === 400
              ? "invalidForm"
              : "failed",
    };
  }
}
