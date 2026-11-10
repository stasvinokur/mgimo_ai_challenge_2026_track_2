import { describe, expect, it } from "vitest";
import type { Actor } from "@/application/ports/actor";
import { parsePageQuery } from "@/application/regulations/schemas";
import {
  GetRegulation,
  ListRegulations,
  SearchRegulations,
} from "@/application/regulations/use-cases";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/application/shared/errors";
import { FakeRegulations } from "../fakes/regulations";

const student: Actor = {
  kind: "student",
  userId: "anna",
  studentId: "anna",
  facultyId: "fmo",
};
const staff: Actor = {
  kind: "staff",
  userId: "marina",
  staffId: "marina",
  facultyIds: ["fmo"],
};

it("документ из БД: преамбула, естественный порядок и стабильные ссылки", async () => {
  const repository = new FakeRegulations();
  const result = await new GetRegulation(repository).execute(student, {
    slug: "scholarship",
  });
  expect(result.title).toBe("Стипендии");
  expect(result.sections.map((s) => s.section)).toEqual(["2", "2.2", "2.10"]);
  expect(result.sections[1]).toMatchObject({
    anchor: "p-2-2",
    href: "/regulations/scholarship#p-2-2",
  });
  expect(await new ListRegulations(repository).execute(student)).toEqual(
    repository.documents,
  );
  await expect(
    new GetRegulation(repository).execute(student, { slug: "unknown" }),
  ).rejects.toBeInstanceOf(NotFoundError);
});

it("поиск обрезает пробелы, отдаёт до 5 пунктов и ссылку", async () => {
  const repository = new FakeRegulations();
  const first = repository.matches[0];
  if (!first) throw new Error("Нет тестового результата.");
  repository.matches = Array.from({ length: 8 }, (_, index) => ({
    ...first,
    section: `${index + 1}`,
  }));
  const result = await new SearchRegulations(repository).execute(student, {
    query: "  повышенная стипендия  ",
  });
  expect(repository.calls).toEqual(["повышенная стипендия"]);
  expect(result).toHaveLength(5);
  expect(result[1]?.href).toBe("/regulations/scholarship#p-2");
});

it.each(["", "  ", "а".repeat(201), null, ["стипендия"]])(
  "невалидный поиск %j не обращается в БД",
  async (query) => {
    const repository = new FakeRegulations();
    await expect(
      new SearchRegulations(repository).execute(student, { query }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repository.calls).toEqual([]);
  },
);

it("запрос из 200 символов разрешён; нулевой результат сохраняется", async () => {
  const repository = new FakeRegulations();
  repository.matches = [];
  expect(
    await new SearchRegulations(repository).execute(student, {
      query: "а".repeat(200),
    }),
  ).toEqual([]);
});

it.each(Array.from({ length: 33 }, (_, index) => (index === 32 ? 127 : index)))(
  "управляющий символ с кодом %i отвергается до trim и обращения к поиску",
  async (code) => {
    const repository = new FakeRegulations();
    const useCase = new SearchRegulations(repository);
    for (const query of [
      String.fromCharCode(code),
      `стипендия${String.fromCharCode(code)}`,
    ]) {
      await expect(useCase.execute(student, { query })).rejects.toMatchObject({
        name: "ValidationError",
        fieldErrors: {
          query: ["INVALID_REGULATION_QUERY"],
        },
      });
    }
    expect(repository.calls).toEqual([]);
  },
);

describe("границы доступа до обращения к портам", () => {
  it("каждый use case запрещён сотруднику", async () => {
    const repository = new FakeRegulations();
    await expect(
      new ListRegulations(repository).execute(staff),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      new GetRegulation(repository).execute(staff, { slug: "scholarship" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      new SearchRegulations(repository).execute(staff, { query: "стипендия" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(repository.calls).toEqual([]);
  });
  it.each(["studentId", "userId", "groupId"])(
    "подмена %s отвергается",
    async (key) => {
      const repository = new FakeRegulations();
      await expect(
        new ListRegulations(repository).execute(student, { [key]: "timur" }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        new GetRegulation(repository).execute(student, {
          slug: "scholarship",
          [key]: "timur",
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        new SearchRegulations(repository).execute(student, {
          query: "стипендия",
          [key]: "timur",
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(() => parsePageQuery({ [key]: "timur" })).toThrow(NotFoundError);
      expect(repository.calls).toEqual([]);
    },
  );
});
