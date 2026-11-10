import { beforeEach, expect, it, vi } from "vitest";
import { requireStudent } from "@/app/_lib/get-actor";
import { getRequestProfileAction } from "@/app/(student)/requests/actions";
import { ForbiddenError } from "@/application/shared/errors";
import { requests } from "@/composition/container";
import { anna, FakeStudentRepository } from "../fakes/identity";

vi.mock("server-only", () => ({}));
vi.mock("@/app/_lib/get-actor", () => ({ requireStudent: vi.fn() }));
vi.mock("@/composition/container", () => ({
  requests: { getCatalog: { execute: vi.fn() } },
}));
beforeEach(() => vi.clearAllMocks());

it("профиль черновика берётся только для Actor из сессии", async () => {
  vi.mocked(requireStudent).mockResolvedValue(
    anna as Awaited<ReturnType<typeof requireStudent>>,
  );
  const profile = new FakeStudentRepository().profiles.get("anna-student");
  if (!profile) throw new Error("Нужен профиль");
  vi.mocked(requests.getCatalog.execute).mockResolvedValue({
    profile,
    types: [],
  });
  const result = await getRequestProfileAction();
  expect(result).toEqual({
    ok: true,
    profile: {
      fullName: profile.fullName,
      faculty: profile.faculty,
      program: profile.program,
      course: profile.course,
      group: profile.group,
      recordBookNo: profile.recordBookNo,
    },
  });
  if (!result.ok) throw new Error("Ожидался профиль");
  expect(Object.keys(result.profile).sort()).toEqual([
    "course",
    "faculty",
    "fullName",
    "group",
    "program",
    "recordBookNo",
  ]);
  expect(result.profile).not.toHaveProperty("scholarship");
  expect(requests.getCatalog.execute).toHaveBeenCalledExactlyOnceWith(anna);
});

it("без студенческой сессии профиль не запрашивается", async () => {
  vi.mocked(requireStudent).mockRejectedValue(new ForbiddenError());
  await expect(getRequestProfileAction()).rejects.toThrow(ForbiddenError);
  expect(requests.getCatalog.execute).not.toHaveBeenCalled();
});
