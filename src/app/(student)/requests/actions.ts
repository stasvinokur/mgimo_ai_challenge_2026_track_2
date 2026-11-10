"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { requireStudent } from "@/app/_lib/get-actor";
import { mapActionError } from "@/app/_lib/map-errors";
import {
  EVENT_RELEASE_TYPE,
  parseRequestForm,
} from "@/application/requests/schemas";
import { ConflictError, NotFoundError } from "@/application/shared/errors";
import { requests } from "@/composition/container";
import type { RequestProfileAction } from "@/ui/requests/profile-fields";

function failure(error: unknown) {
  if (error instanceof NotFoundError) notFound();
  return mapActionError(error);
}

export async function getRequestProfileAction(): ReturnType<RequestProfileAction> {
  const actor = await requireStudent();
  try {
    const { profile } = await requests.getCatalog.execute(actor);
    return {
      ok: true,
      profile: {
        fullName: profile.fullName,
        faculty: profile.faculty,
        program: profile.program,
        course: profile.course,
        group: profile.group,
        recordBookNo: profile.recordBookNo,
      },
    };
  } catch (error) {
    return failure(error);
  }
}

export async function saveRequestDraftAction(input: unknown) {
  const actor = await requireStudent();
  try {
    const data = parseRequestForm(input);
    if (data.id) {
      const own = await requests.getMyRequest.execute(actor, { id: data.id });
      if (own.type.code !== data.typeCode) throw new ConflictError();
    }
    const payload = data.review
      ? await requests.checkPayload.execute(actor, {
          typeCode: data.typeCode,
          payload: data.payload,
        })
      : data.payload;
    const result = data.id
      ? await requests.updateDraft.execute(actor, { id: data.id, payload })
      : await requests.createDraft.execute(actor, {
          typeCode: data.typeCode,
          payload,
        });
    const eventLessons =
      data.review && data.typeCode === EVENT_RELEASE_TYPE
        ? await requests.previewEvent.execute(actor, {
            dateFrom: payload.dateFrom,
            dateTo: payload.dateTo,
          })
        : undefined;
    revalidatePath("/requests");
    return {
      ok: true as const,
      id: result.id,
      payload: eventLessons ? { ...payload, eventLessons } : payload,
      review: data.review,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function submitRequestAction(id: string) {
  const actor = await requireStudent();
  try {
    const result = await requests.submitRequest.execute(actor, { id });
    revalidatePath("/requests");
    revalidatePath(`/requests/${result.id}`);
    return { ok: true as const, id: result.id };
  } catch (error) {
    return failure(error);
  }
}

export async function changeRequestStatusAction(input: unknown) {
  const actor = await requireStudent();
  try {
    const result = await requests.changeRequestStatus.execute(actor, input);
    revalidatePath("/requests");
    revalidatePath(`/requests/${result.id}`);
    return { ok: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteRequestDraftAction(id: string) {
  const actor = await requireStudent();
  try {
    await requests.deleteDraft.execute(actor, { id });
    revalidatePath("/requests");
    return { ok: true as const };
  } catch (error) {
    return failure(error);
  }
}
