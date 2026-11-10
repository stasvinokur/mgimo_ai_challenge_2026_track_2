"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireTeacher } from "@/app/_lib/get-actor";
import { mapActionError, mapPageError } from "@/app/_lib/map-errors";
import { requireAttendanceOrigin } from "@/app/attend/origin";
import {
  type FieldErrors,
  ForbiddenError,
  NotFoundError,
} from "@/application/shared/errors";
import { notifications, teacher } from "@/composition/container";

export interface GradeActionState {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: FieldErrors;
  code?: string;
}

export async function setGrade(
  lesson: { slotId: string; occurrenceDate: string },
  _previous: GradeActionState,
  form: FormData,
): Promise<GradeActionState> {
  const actor = await requireTeacher();
  try {
    await requireAttendanceOrigin();
    const fields = Object.fromEntries(
      [...form].filter(([key]) => !key.startsWith("$ACTION_")),
    );
    const score = fields.score;
    const expectedScore = fields.expectedScore;
    const result = await teacher.setGrade.executeWithRecipient(actor, {
      ...fields,
      ...lesson,
      score:
        typeof score === "string" && score.trim() !== ""
          ? Number(score)
          : Number.NaN,
      expectedScore:
        expectedScore === ""
          ? null
          : typeof expectedScore === "string" && expectedScore.trim() !== ""
            ? Number(expectedScore)
            : Number.NaN,
      reason: fields.reason === "" ? undefined : fields.reason,
    });
    const recipient = result.pushRecipient;
    if (recipient)
      after(() =>
        notifications.push.dispatch.executeForTeacherGrade(actor, recipient),
      );
    revalidatePath("/teacher/grades");
    revalidatePath(`/teacher/grades/${lesson.slotId}/${lesson.occurrenceDate}`);
    revalidatePath(`/grades/${result.courseId}`);
    revalidatePath("/grades");
    revalidatePath("/today");
    revalidatePath("/notifications");
    return {
      status: "success",
      message: result.changed ? "Балл сохранён" : "Балл не изменился",
    };
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError)
      mapPageError(error);
    const result = mapActionError(error);
    return {
      status: "error",
      message: result.error.message,
      fieldErrors: result.error.fieldErrors,
      code: result.error.code,
    };
  }
}
