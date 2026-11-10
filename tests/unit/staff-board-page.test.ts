import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import Page from "@/app/(staff)/staff/requests/(list)/page";
import type { Actor } from "@/application/ports/actor";
import { ForbiddenError, NotFoundError } from "@/application/shared/errors";
import type { StaffQueueCardDto } from "@/application/staff/dto";
import type { StaffQueueDto } from "@/application/staff/queries";

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  profile: vi.fn(),
  mapError: vi.fn(),
  change: vi.fn(),
  router: { refresh: vi.fn() },
}));
vi.mock("@/app/_lib/get-actor", () => ({ requireStaff: mocks.requireStaff }));
vi.mock("@/app/_lib/map-errors", () => ({ mapPageError: mocks.mapError }));
vi.mock("@/composition/container", () => ({
  staff: {
    listRequests: { execute: mocks.list },
    getRequest: { execute: mocks.detail },
  },
  identity: { getStaffProfile: { execute: mocks.profile } },
}));
vi.mock("@/app/(staff)/staff/requests/actions", () => ({
  changeStaffRequestStatusAction: mocks.change,
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));

const actor: Actor = {
  kind: "staff",
  userId: "current-user",
  staffId: "current-staff",
  facultyIds: ["current-faculty"],
};
const question = "Уточните название учебной организации.";

function card(
  id: string,
  status: StaffQueueCardDto["status"],
  sla: StaffQueueCardDto["sla"] = "on_time",
): StaffQueueCardDto {
  return {
    id: `00000000-0000-7000-8000-${id.padStart(12, "0")}`,
    publicNo: `З-2026-${id.padStart(6, "0")}`,
    type: { code: "enrollment", title: "Справка об обучении" },
    student: { fullName: "Учебный студент", group: "ДЕМО-1" },
    status,
    submittedAt: "2026-11-06T09:00:00.000Z",
    dueAt: "2026-11-10T09:00:00.000Z",
    sla,
    assignee: "Учебный сотрудник",
    actions:
      status === "in_progress" ? ["needs_info", "ready", "rejected"] : [],
  };
}

function queue(requests: StaffQueueCardDto[]): StaffQueueDto {
  return {
    demoCommentsOnly: false,
    requests,
    types: [{ code: "enrollment", title: "Справка об обучении" }],
    filters: { type: "", sla: "all", scope: "all", q: "" },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireStaff.mockResolvedValue(actor);
  mocks.profile.mockResolvedValue({ fullName: "Учебный сотрудник" });
  mocks.mapError.mockImplementation((error: unknown) => {
    throw error;
  });
  mocks.list.mockResolvedValue(queue([]));
});

it("удаление needs_info между списком и чтением вопроса не превращает всю доску в404", async () => {
  const active = card("1", "in_progress");
  const removed = card("2", "needs_info", "overdue");
  const retained = card("3", "needs_info", "soon");
  const data = queue([active, removed, retained]);
  mocks.list.mockResolvedValue(data);
  mocks.detail.mockImplementation(
    async (_actor: Actor, { id }: { id: string }) => {
      if (id === removed.id) throw new NotFoundError();
      return { status: "needs_info", events: [{ comment: question }] };
    },
  );

  const page = await Page({ searchParams: Promise.resolve({ scope: "all" }) });
  expect(page.props.data.requests).toEqual([active, retained]);
  expect(page.props.questions).toEqual({ [retained.id]: question });
  expect(data.requests).toEqual([active, removed, retained]);
  expect(mocks.mapError).not.toHaveBeenCalled();
  expect(mocks.list).toHaveBeenCalledExactlyOnceWith(actor, { scope: "all" });
  expect(mocks.detail).toHaveBeenCalledWith(actor, { id: removed.id });

  const html = renderToStaticMarkup(page);
  expect(html).toContain('href="/staff/profile"');
  expect(html).toContain("Мой профиль");
  expect(html).toContain(`data-request-id="${active.id}"`);
  expect(html).toContain(`data-request-id="${retained.id}"`);
  expect(html).not.toContain(`data-request-id="${removed.id}"`);
  expect(html).toContain(question);
  expect(html).toContain("<strong>0</strong><span>Просрочено</span>");
  expect(html).toContain("<strong>1</strong><span>Ждём студента</span>");
  expect(html).toContain("Нужна информация");
  expect(html).toContain("Готова");
  expect(html).toContain("Отклонить");
});

it("после удаления всех карточек остаются пустое состояние и ссылка профиля", async () => {
  mocks.list.mockResolvedValue(queue([card("1", "needs_info")]));
  mocks.detail.mockRejectedValue(new NotFoundError());
  const page = await Page({ searchParams: Promise.resolve({}) });
  const html = renderToStaticMarkup(page);
  expect(page.props.data.requests).toEqual([]);
  expect(page.props.questions).toEqual({});
  expect(html).toContain("Заявок по выбранным условиям нет");
  expect(html).toContain('href="/staff/profile"');
  expect(mocks.mapError).not.toHaveBeenCalled();
});

it.each([new ForbiddenError(), new Error("Тестовый отказ БД")])(
  "ошибка дополнительного чтения %s передаётся в прежний маппинг",
  async (error) => {
    mocks.list.mockResolvedValue(queue([card("1", "needs_info")]));
    mocks.detail.mockRejectedValue(error);
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toBe(
      error,
    );
    expect(mocks.mapError).toHaveBeenCalledExactlyOnceWith(error);
  },
);

it("NotFound самого профиля по-прежнему передаётся в маппинг", async () => {
  const error = new NotFoundError();
  mocks.profile.mockRejectedValue(error);
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toBe(error);
  expect(mocks.mapError).toHaveBeenCalledExactlyOnceWith(error);
});

it("без доступа к staff источники не вызываются", async () => {
  const error = new ForbiddenError();
  mocks.requireStaff.mockRejectedValue(error);
  await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toBe(error);
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.profile).not.toHaveBeenCalled();
  expect(mocks.detail).not.toHaveBeenCalled();
});
