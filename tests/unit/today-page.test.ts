import { beforeEach, expect, it, vi } from "vitest";
import Page from "@/app/(student)/today/page";
import type { Source, TodayDto } from "@/application/today/get-today";

const mocks = vi.hoisted(() => ({
  requireStudent: vi.fn(),
  overview: vi.fn(),
  week: vi.fn(),
  profile: vi.fn(),
  onboarding: vi.fn(),
  mapError: vi.fn(),
}));
vi.mock("@/ui/i18n/server", () => ({ getLanguage: async () => "ru" }));
vi.mock("@/app/_lib/get-actor", () => ({
  requireStudent: mocks.requireStudent,
}));
vi.mock("@/app/_lib/map-errors", () => ({ mapPageError: mocks.mapError }));
vi.mock("@/composition/container", () => ({
  speech: { enabled: false },
  today: { getOverview: { execute: mocks.overview } },
  schedule: { getWeek: { execute: mocks.week } },
  student: { getMyProfile: { execute: mocks.profile } },
  onboarding: { getMyOnboarding: { execute: mocks.onboarding } },
}));
const actor = {
  kind: "student",
  userId: "current-user",
  studentId: "current-student",
  facultyId: "current-faculty",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireStudent.mockResolvedValue(actor);
  mocks.overview.mockResolvedValue({ asOf: "2026-11-04T09:00:00Z" });
  mocks.week.mockResolvedValue({ week: "2026-W45" });
  mocks.profile.mockResolvedValue({ fullName: "Анна Соколова" });
  mocks.onboarding.mockResolvedValue(null);
});

it("все use case получают один actor из requireStudent, входных id нет", async () => {
  const page = await Page();
  expect(mocks.requireStudent).toHaveBeenCalledOnce();
  for (const execute of [
    mocks.overview,
    mocks.week,
    mocks.profile,
    mocks.onboarding,
  ])
    expect(execute).toHaveBeenCalledExactlyOnceWith(actor);
  expect(page.props.profile).toEqual({
    ok: true,
    data: { fullName: "Анна Соколова" },
  });
  expect(page.props.week.ok).toBe(true);
  expect(page.props.onboarding).toEqual({ ok: true, data: null });
});

it.each(["week", "profile", "onboarding"] as const)(
  "сбой %s не скрывает обзор и второй источник",
  async (key) => {
    mocks[key].mockImplementation(() => {
      throw new Error("Технические подробности");
    });
    const page = await Page();
    const props = page.props as {
      data: TodayDto;
      week: Source<unknown>;
      profile: Source<unknown>;
      onboarding: Source<unknown>;
    };
    expect(props[key]).toEqual({ ok: false });
    expect(props[key === "week" ? "profile" : "week"].ok).toBe(true);
    expect(props.data.asOf).toBe("2026-11-04T09:00:00Z");
    expect(mocks.mapError).not.toHaveBeenCalled();
  },
);

it("без роли студента источники не вызываются", async () => {
  const error = new Error("Нет доступа");
  mocks.requireStudent.mockRejectedValue(error);
  await expect(Page()).rejects.toBe(error);
  for (const execute of [
    mocks.overview,
    mocks.week,
    mocks.profile,
    mocks.onboarding,
  ])
    expect(execute).not.toHaveBeenCalled();
});

it("ошибка самого обзора проходит через существующий маппинг", async () => {
  const error = new Error("Обзор недоступен");
  mocks.overview.mockRejectedValue(error);
  await Page();
  expect(mocks.mapError).toHaveBeenCalledExactlyOnceWith(error);
});
