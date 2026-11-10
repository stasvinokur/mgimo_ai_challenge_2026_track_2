import { expect, it } from "vitest";
import type { Actor } from "@/application/ports/actor";
import { ForbiddenError, NotFoundError } from "@/application/shared/errors";
import { FakeClock } from "../fakes/clock";
import { SequentialIdGenerator } from "../fakes/id-generator";
import { InMemoryOwnedRepository } from "../fakes/owned-repository";

it("управляемые часы возвращают копию времени и допускают перевод вперёд", () => {
  const initial = new Date("2026-11-04T09:00:00.000Z");
  const clock = new FakeClock(initial);
  initial.setUTCFullYear(2000);
  clock.now().setUTCFullYear(2001);
  expect(clock.now().toISOString()).toBe("2026-11-04T09:00:00.000Z");
  clock.advance(60_000);
  expect(clock.now().toISOString()).toBe("2026-11-04T09:01:00.000Z");
  clock.set("2026-11-05T09:00:00.000Z");
  expect(clock.now().toISOString()).toBe("2026-11-05T09:00:00.000Z");
});

it("генератор выдаёт повторяемую последовательность uuid v7", () => {
  const ids = new SequentialIdGenerator();
  expect(ids.next()).toBe("00000000-0000-7000-8000-000000000001");
  expect(ids.next()).toBe("00000000-0000-7000-8000-000000000002");
  expect(new SequentialIdGenerator().next()).toBe(
    "00000000-0000-7000-8000-000000000001",
  );
});

const records = [
  { id: "anna-record", studentId: "anna-student", title: "Учебная справка" },
  { id: "timur-record", studentId: "timur-student", title: "Заявка" },
];

class ReadOwnedRecord {
  constructor(
    private readonly repository: InMemoryOwnedRepository<
      (typeof records)[number]
    >,
  ) {}

  async execute(actor: Actor, input: { id: string }) {
    if (actor.kind !== "student") throw new ForbiddenError();
    const record = await this.repository.findByIdForStudent(
      input.id,
      actor.studentId,
    );
    if (!record) throw new NotFoundError();
    return { id: record.id, title: record.title };
  }
}

const anna: Actor = {
  kind: "student",
  userId: "anna-user",
  studentId: "anna-student",
  facultyId: "faculty",
};

it("сценарий берёт владельца из Actor: чужой и отсутствующий объекты неразличимы", async () => {
  const useCase = new ReadOwnedRecord(new InMemoryOwnedRepository(records));
  await expect(useCase.execute(anna, { id: "anna-record" })).resolves.toEqual({
    id: "anna-record",
    title: "Учебная справка",
  });
  for (const id of ["timur-record", "absent"]) {
    await expect(useCase.execute(anna, { id })).rejects.toThrow(NotFoundError);
  }
  await expect(
    useCase.execute(
      {
        kind: "staff",
        userId: "staff-user",
        staffId: "staff",
        facultyIds: ["faculty"],
      },
      { id: "anna-record" },
    ),
  ).rejects.toThrow(ForbiddenError);
});

it("список фильтруется по владельцу, изменения копии не изменяют хранилище", async () => {
  const seed = structuredClone(records);
  const repository = new InMemoryOwnedRepository(seed);
  const initial = seed[0];
  if (!initial) throw new Error("Не подготовлена фикстура.");
  initial.title = "Изменённый исходник";
  const own = await repository.findByIdForStudent(
    "anna-record",
    "anna-student",
  );
  if (!own) throw new Error("Не найдена собственная запись.");
  own.title = "Изменённая копия";
  const list = await repository.listForStudent("anna-student");
  expect(list).toEqual([records[0]]);
  const first = list[0];
  if (!first) throw new Error("Не найдена запись в списке.");
  first.title = "Изменённый список";
  expect(
    await repository.findByIdForStudent("anna-record", "anna-student"),
  ).toEqual(records[0]);
  expect(await repository.listForStudent("unknown-student")).toEqual([]);
});
