import { expect, it, vi } from "vitest";
import { ForbiddenError, NotFoundError } from "@/application/shared/errors";
import { GetMyProfile } from "@/application/student/get-my-profile";

const actor = {
  kind: "student",
  userId: "profile-user",
  studentId: "profile-student",
  facultyId: "profile-faculty",
} as const;
const profile = {
  fullName: "Анна Соколова",
  faculty: "Вымышленный факультет",
  program: "Учебная программа",
  course: 2,
  group: "ДЕМО-2",
  recordBookNo: "DEMO-0001",
  scholarship: "increased",
} as const;

it("профиль возвращает код стипендии и исходные данные только владельца", async () => {
  const findProfileForStudent = vi.fn(async () => profile);
  const useCase = new GetMyProfile({ findProfileForStudent });
  expect(await useCase.execute(actor)).toEqual(profile);
  expect(findProfileForStudent).toHaveBeenCalledExactlyOnceWith(
    actor.studentId,
  );
});

it("отсутствующий профиль и чужая роль сохраняют прежние ошибки доступа", async () => {
  const findProfileForStudent = vi.fn(async () => null);
  const useCase = new GetMyProfile({ findProfileForStudent });
  await expect(useCase.execute(actor)).rejects.toBeInstanceOf(NotFoundError);
  findProfileForStudent.mockClear();
  await expect(
    useCase.execute({
      kind: "staff",
      userId: "staff-user",
      staffId: "staff",
      facultyIds: [],
    }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  expect(findProfileForStudent).not.toHaveBeenCalled();
});
