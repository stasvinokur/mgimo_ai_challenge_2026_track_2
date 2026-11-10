import { beforeEach, describe, expect, it, vi } from "vitest";
import { changePickupAction } from "@/app/(staff)/staff/pickup/actions";
import { setGrade } from "@/app/(teacher)/teacher/grades/actions";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/application/shared/errors";
import { marina } from "../fakes/identity";
import { oleg } from "../fakes/teacher";

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  requireTeacher: vi.fn(),
  pickupOrigin: vi.fn(),
  gradeOrigin: vi.fn(),
  changePickup: vi.fn(),
  setGrade: vi.fn(),
  dispatchRequest: vi.fn(),
  dispatchGrade: vi.fn(),
  after: vi.fn(),
  revalidate: vi.fn(),
  notFound: vi.fn(),
  mapActionError: vi.fn(),
  mapPageError: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/app/_lib/get-actor", () => ({
  requireStaff: mocks.requireStaff,
  requireTeacher: mocks.requireTeacher,
}));
vi.mock("@/app/(student)/requests/pickup-origin", () => ({
  requirePickupOrigin: mocks.pickupOrigin,
}));
vi.mock("@/app/attend/origin", () => ({
  requireAttendanceOrigin: mocks.gradeOrigin,
}));
vi.mock("@/app/_lib/map-errors", () => ({
  mapActionError: mocks.mapActionError,
  mapPageError: mocks.mapPageError,
}));
vi.mock("@/composition/container", () => ({
  staff: { changePickup: { execute: mocks.changePickup } },
  teacher: { setGrade: { executeWithRecipient: mocks.setGrade } },
  notifications: {
    push: {
      dispatch: {
        executeForRequest: mocks.dispatchRequest,
        executeForTeacherGrade: mocks.dispatchGrade,
      },
    },
  },
}));

const lesson = { slotId: "form-slot", occurrenceDate: "2026-11-05" };
const recipient = {
  userId: "committed-student-user",
  slotId: "committed-slot",
  occurrenceDate: "2026-11-06",
  entryKey: "committed-entry",
};
const previous = { status: "idle" as const, message: "" };

function gradeForm() {
  const form = new FormData();
  form.set("entryKey", "form-entry");
  form.set("score", "80");
  form.set("expectedScore", "");
  form.set("reason", "");
  form.set("$ACTION_TEST", "ignored");
  return form;
}

function background() {
  expect(mocks.after).toHaveBeenCalledOnce();
  return mocks.after.mock.calls[0]?.[0] as () => Promise<void>;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireStaff.mockResolvedValue(marina);
  mocks.requireTeacher.mockResolvedValue(oleg);
  mocks.changePickup.mockResolvedValue({ requestId: "committed-request" });
  mocks.setGrade.mockResolvedValue({
    changed: true,
    courseId: "course",
    pushRecipient: recipient,
  });
  mocks.mapActionError.mockReturnValue({
    ok: false,
    error: { message: "Действие не выполнено.", code: "TEST_ERROR" },
  });
  mocks.notFound.mockImplementation(() => {
    throw new Error("TEST_NOT_FOUND");
  });
  mocks.mapPageError.mockImplementation((error) => {
    throw error;
  });
});

describe("push из очереди выдачи", () => {
  it.each(["called", "served", "no_show"])(
    "переход %s планирует отправку после commit и возвращает ответ до медленного dispatcher",
    async (to) => {
      const entered = Promise.withResolvers<void>();
      const committed = Promise.withResolvers<{ requestId: string }>();
      const release = Promise.withResolvers<void>();
      mocks.changePickup.mockImplementation(() => {
        entered.resolve();
        return committed.promise;
      });
      mocks.dispatchRequest.mockReturnValue(release.promise);
      const input = { id: "booking", to, requestId: "client-request" };
      const work = changePickupAction(input);
      await entered.promise;
      expect(mocks.after).not.toHaveBeenCalled();
      expect(mocks.dispatchRequest).not.toHaveBeenCalled();
      committed.resolve({ requestId: "committed-request" });
      const result = await work;
      expect(result).toEqual({ ok: true });
      expect(mocks.changePickup).toHaveBeenCalledExactlyOnceWith(marina, input);
      expect(mocks.revalidate).toHaveBeenCalledWith(
        "/requests/committed-request",
      );
      expect(mocks.dispatchRequest).not.toHaveBeenCalled();
      const delivery = background()();
      expect(mocks.dispatchRequest).toHaveBeenCalledExactlyOnceWith(
        marina,
        "committed-request",
      );
      expect(result).toEqual({ ok: true });
      release.resolve();
      await delivery;
    },
  );

  it("отказ проверки роли не запускает use case и after", async () => {
    mocks.requireStaff.mockRejectedValue(new ForbiddenError());
    await expect(changePickupAction({})).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.changePickup).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("неверный Origin не запускает use case и after", async () => {
    mocks.pickupOrigin.mockRejectedValue(new ForbiddenError());
    expect(await changePickupAction({})).toHaveProperty("ok", false);
    expect(mocks.changePickup).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it.each([new NotFoundError(), new Error("TEST_TRANSITION_FAILED")])(
    "ошибка перехода не планирует push: $name",
    async (error) => {
      mocks.changePickup.mockRejectedValue(error);
      if (error instanceof NotFoundError)
        await expect(changePickupAction({})).rejects.toThrow("TEST_NOT_FOUND");
      else expect(await changePickupAction({})).toHaveProperty("ok", false);
      expect(mocks.after).not.toHaveBeenCalled();
      expect(mocks.dispatchRequest).not.toHaveBeenCalled();
    },
  );
});

describe("push при записи балла", () => {
  it("планирует после commit получателя из серверного результата, сохраняя браузерный DTO", async () => {
    const entered = Promise.withResolvers<void>();
    const committed = Promise.withResolvers<{
      changed: boolean;
      courseId: string;
      pushRecipient: typeof recipient;
    }>();
    const release = Promise.withResolvers<void>();
    mocks.setGrade.mockImplementation(() => {
      entered.resolve();
      return committed.promise;
    });
    mocks.dispatchGrade.mockReturnValue(release.promise);
    const work = setGrade(lesson, previous, gradeForm());
    await entered.promise;
    expect(mocks.after).not.toHaveBeenCalled();
    committed.resolve({
      changed: true,
      courseId: "course",
      pushRecipient: recipient,
    });
    const result = await work;
    expect(mocks.setGrade).toHaveBeenCalledExactlyOnceWith(oleg, {
      ...lesson,
      entryKey: "form-entry",
      score: 80,
      expectedScore: null,
      reason: undefined,
    });
    expect(result).toEqual({ status: "success", message: "Балл сохранён" });
    expect(JSON.stringify(result)).not.toContain(recipient.userId);
    expect(result).not.toHaveProperty("pushRecipient");
    expect(mocks.dispatchGrade).not.toHaveBeenCalled();
    const delivery = background()();
    expect(mocks.dispatchGrade).toHaveBeenCalledExactlyOnceWith(
      oleg,
      recipient,
    );
    expect(result).toEqual({ status: "success", message: "Балл сохранён" });
    release.resolve();
    await delivery;
  });

  it.each([true, false])(
    "без получателя не запускает push, changed=%s",
    async (changed) => {
      mocks.setGrade.mockResolvedValue({
        changed,
        courseId: "course",
        pushRecipient: null,
      });
      const result = await setGrade(lesson, previous, gradeForm());
      expect(result).toEqual({
        status: "success",
        message: changed ? "Балл сохранён" : "Балл не изменился",
      });
      expect(mocks.after).not.toHaveBeenCalled();
      expect(mocks.dispatchGrade).not.toHaveBeenCalled();
    },
  );

  it("отказ проверки роли не запускает use case и after", async () => {
    mocks.requireTeacher.mockRejectedValue(new ForbiddenError());
    await expect(
      setGrade(lesson, previous, gradeForm()),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.setGrade).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("неверный Origin не запускает use case и after", async () => {
    mocks.gradeOrigin.mockRejectedValue(new Error("TEST_ORIGIN_FAILED"));
    expect(await setGrade(lesson, previous, gradeForm())).toHaveProperty(
      "status",
      "error",
    );
    expect(mocks.setGrade).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it.each([
    new NotFoundError(),
    new ForbiddenError(),
    new ValidationError({ score: ["Проверьте балл."] }),
    new Error("TEST_WRITE_FAILED"),
  ])("ошибка записи не планирует push: $name", async (error) => {
    mocks.setGrade.mockRejectedValue(error);
    if (error instanceof NotFoundError || error instanceof ForbiddenError)
      await expect(setGrade(lesson, previous, gradeForm())).rejects.toBe(error);
    else
      expect(await setGrade(lesson, previous, gradeForm())).toHaveProperty(
        "status",
        "error",
      );
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.dispatchGrade).not.toHaveBeenCalled();
  });
});
