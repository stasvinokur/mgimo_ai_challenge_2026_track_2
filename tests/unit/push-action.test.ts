import { beforeEach, expect, it, vi } from "vitest";
import { changeStaffRequestStatusAction } from "@/app/(staff)/staff/requests/actions";
import { marina } from "../fakes/identity";

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  change: vi.fn(),
  dispatch: vi.fn(),
  after: vi.fn(),
  revalidate: vi.fn(),
  mapError: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("@/app/_lib/get-actor", () => ({ requireStaff: mocks.requireStaff }));
vi.mock("@/app/_lib/map-errors", () => ({ mapActionError: mocks.mapError }));
vi.mock("@/composition/container", () => ({
  staff: { changeStatus: { execute: mocks.change } },
  notifications: { push: { dispatch: { executeForRequest: mocks.dispatch } } },
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireStaff.mockResolvedValue(marina);
  mocks.change.mockResolvedValue({ id: "request" });
});

it("ответ сотруднику и revalidate завершаются до запуска медленного push в after", async () => {
  const release = Promise.withResolvers<void>();
  mocks.dispatch.mockReturnValue(release.promise);
  const input = { id: "request", to: "ready" };
  const response = await changeStaffRequestStatusAction(input);
  expect(response).toEqual({ ok: true });
  expect(mocks.change).toHaveBeenCalledExactlyOnceWith(marina, input);
  expect(mocks.after).toHaveBeenCalledOnce();
  expect(mocks.dispatch).not.toHaveBeenCalled();
  expect(mocks.revalidate).toHaveBeenCalledWith("/requests/request");
  const callback = mocks.after.mock.calls[0]?.[0] as () => Promise<void>;
  const background = callback();
  expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith(marina, "request");
  expect(response).toEqual({ ok: true });
  release.resolve();
  await background;
});

it("не планирует push после отказа перехода статуса", async () => {
  const error = new Error("TEST_TRANSITION_FAILED");
  mocks.change.mockRejectedValue(error);
  mocks.mapError.mockReturnValue({ ok: false });
  expect(await changeStaffRequestStatusAction({ id: "request" })).toEqual({
    ok: false,
  });
  expect(mocks.after).not.toHaveBeenCalled();
  expect(mocks.dispatch).not.toHaveBeenCalled();
});
