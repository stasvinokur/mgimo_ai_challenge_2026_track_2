import { expect, it, vi } from "vitest";
import type { Actor } from "@/application/ports/actor";
import type { RegulationSection } from "@/application/regulations/ports";
import { GetRegulation } from "@/application/regulations/use-cases";
import { GetEventReleaseBasis } from "@/application/requests/event-release-basis";
import { ForbiddenError, NotFoundError } from "@/application/shared/errors";
import { anna, marina } from "../fakes/identity";

function repository(sections: RegulationSection[]) {
  return { findBySlug: vi.fn(async () => structuredClone(sections)) };
}

it("основание сотрудника берёт номер и актуальное название пункта из положения", async () => {
  const source = repository([
    { section: "0", title: "Положение о посещаемости", body: "Преамбула" },
    { section: "3", title: "Другой пункт", body: "Чужой текст" },
    {
      section: "4",
      title: "Обновлённые правила участия в мероприятиях",
      body: "Полный текст не передаётся в карточку сотрудника.",
    },
  ]);
  const basis = await new GetEventReleaseBasis(source).execute(marina);
  expect(source.findBySlug).toHaveBeenCalledExactlyOnceWith("attendance");
  expect(basis).toEqual({
    section: "4",
    title: "Обновлённые правила участия в мероприятиях",
  });
  const studentDocument = await new GetRegulation({
    ...source,
    list: async () => [],
  }).execute(anna, { slug: "attendance" });
  expect(
    studentDocument.sections.find(({ section }) => section === "4"),
  ).toMatchObject(basis);
});

it.each([
  anna,
  { kind: "teacher", userId: "teacher-user", teacherId: "teacher" },
] satisfies Actor[])(
  "метаданные основания: роль $kind отклоняется до чтения репозитория",
  async (actor) => {
    const source = repository([]);
    await expect(
      new GetEventReleaseBasis(source).execute(actor),
    ).rejects.toThrow(ForbiddenError);
    expect(source.findBySlug).not.toHaveBeenCalled();
  },
);

it.each([
  { sections: [] },
  {
    sections: [{ section: "3", title: "Уважительные причины", body: "Текст" }],
  },
])(
  "отсутствующее основание не заменяется придуманным названием: $sections",
  async ({ sections }) => {
    await expect(
      new GetEventReleaseBasis(repository(sections)).execute(marina),
    ).rejects.toThrow(NotFoundError);
  },
);
