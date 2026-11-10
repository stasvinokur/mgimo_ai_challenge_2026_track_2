import { expect, it } from "vitest";
import { ForbiddenError } from "@/application/shared/errors";
import { searchFixture } from "../fakes/search";

it("преподаватель не получает подсказок до валидации и I/O", async () => {
  const d = searchFixture();
  await expect(
    d.search.execute(
      { kind: "teacher", teacherId: "teacher", userId: "user" },
      {},
    ),
  ).rejects.toThrow(ForbiddenError);
  expect(d.grades.calls).toEqual([]);
  expect(d.regulations.calls).toEqual([]);
});

it("одинаковая строка поиска возвращает каждому только собственную заявку", async () => {
  const d = searchFixture();
  const anna = await d.search.execute(d.anna, { q: "000" });
  const timur = await d.search.execute(
    {
      kind: "student",
      facultyId: "fmo",
      userId: "timur-user",
      studentId: "timur",
    },
    { q: "000" },
  );
  expect(anna.groups[2]?.items.map((item) => item.id)).toEqual([
    "request-anna",
  ]);
  expect(timur.groups[2]?.items.map((item) => item.id)).toEqual([
    "request-timur",
  ]);
  expect(d.logs).toEqual([]);
});
