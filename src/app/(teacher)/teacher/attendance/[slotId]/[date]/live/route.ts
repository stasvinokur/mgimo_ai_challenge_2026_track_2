import { requireTeacher } from "@/app/_lib/get-actor";
import { mapRouteError } from "@/app/_lib/map-errors";
import { readAttendanceBody } from "@/app/attend/body";
import { requireAttendanceOrigin } from "@/app/attend/origin";
import { ValidationError } from "@/application/shared/errors";
import { attendance, identity } from "@/composition/container";

const json = (value: unknown) =>
  Response.json(value, {
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
type Context = { params: Promise<{ slotId: string; date: string }> };
export async function GET(_request: Request, context: Context) {
  const actor = await requireTeacher({ routeHandler: true });
  try {
    const { slotId, date } = await context.params;
    return json(
      await attendance.getTeacherAttendance.execute(actor, {
        slotId,
        occurrenceDate: date,
      }),
    );
  } catch (error) {
    return mapRouteError(error);
  }
}
export async function POST(request: Request, context: Context) {
  const actor = await requireTeacher({ routeHandler: true });
  try {
    await requireAttendanceOrigin();
    const { slotId, date } = await context.params;
    const lesson = { slotId, occurrenceDate: date };
    const body = await readAttendanceBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new ValidationError({ input: ["Проверьте действие."] });
    const { action, ...input } = body as Record<string, unknown>;
    const ip = identity.getClientIp(request.headers.get("x-forwarded-for"));
    if (
      action === "issue" &&
      Object.keys(input).every((key) => key === "previousCode")
    )
      return json(
        await attendance.issueCode.execute(actor, { ...input, lesson, ip }),
      );
    if (action === "close" && Object.keys(input).length === 0)
      return json(
        await attendance.closeAttendance.execute(actor, { ...lesson, ip }),
      );
    throw new ValidationError({ input: ["Проверьте действие."] });
  } catch (error) {
    return mapRouteError(error);
  }
}
