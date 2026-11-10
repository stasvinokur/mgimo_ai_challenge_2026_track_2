import { expect, it, vi } from "vitest";
import { changeStaffRequestStatusAction } from "@/app/(staff)/staff/requests/actions";
import {
  latestNotificationTitleAction,
  readAllNotificationsAction,
  readNotificationAction,
} from "@/app/(student)/notifications/actions";
import {
  changeRequestStatusAction,
  deleteRequestDraftAction,
  getRequestProfileAction,
  saveRequestDraftAction,
  submitRequestAction,
} from "@/app/(student)/requests/actions";
import { renewCalendar } from "@/app/(student)/schedule/actions";
import { oleg } from "../fakes/teacher";

const spies = vi.hoisted(() => ({ execute: vi.fn(), revalidate: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: spies.revalidate }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "a".repeat(43) }) }),
}));
vi.mock("@/composition/container", () => ({
  identity: {
    sessionCookie: { name: "__Host-pulse-session" },
    getCurrentActor: { execute: async () => ({ actor: oleg }) },
  },
  requests: {
    getCatalog: spies,
    getMyRequest: spies,
    checkPayload: spies,
    updateDraft: spies,
    createDraft: spies,
    submitRequest: spies,
    changeRequestStatus: spies,
    deleteDraft: spies,
  },
  notifications: {
    readMyNotification: spies,
    readAllMyNotifications: spies,
    getLatestTitle: spies,
  },
  schedule: { renewCalendarToken: spies },
  staff: { changeStatus: spies },
  system: { logger: { error: vi.fn() } },
}));

it("все студенческие Server Actions отклоняют преподавателя до use case и revalidate", async () => {
  const actions = [
    () => getRequestProfileAction(),
    () => saveRequestDraftAction({}),
    () => submitRequestAction("foreign"),
    () => changeRequestStatusAction({}),
    () => deleteRequestDraftAction("foreign"),
    () => readNotificationAction({}),
    () => readAllNotificationsAction(),
    () => latestNotificationTitleAction({}),
    () => renewCalendar(null, new FormData()),
  ];
  for (const action of actions)
    await expect(action()).rejects.toMatchObject({
      digest: expect.stringContaining("/teacher"),
    });
  expect(spies.execute).not.toHaveBeenCalled();
  expect(spies.revalidate).not.toHaveBeenCalled();
});

it("преподаватель получает 403 от staff-действия до use case и revalidate", async () => {
  vi.stubEnv("__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS", "true");
  await expect(
    changeStaffRequestStatusAction({ id: "foreign", to: "accepted" }),
  ).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;403" });
  expect(spies.execute).not.toHaveBeenCalled();
  expect(spies.revalidate).not.toHaveBeenCalled();
});
