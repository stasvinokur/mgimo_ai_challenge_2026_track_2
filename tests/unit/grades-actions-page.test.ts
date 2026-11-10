import { Children, isValidElement } from "react";
import { expect, it, vi } from "vitest";
import Page from "@/app/(student)/grades/[courseId]/page";
import { GetCourseActions } from "@/application/grades/get-course-actions";
import {
  GetCourseGrades,
  GetMyGrades,
} from "@/application/grades/get-my-grades";
import { NotFoundError } from "@/application/shared/errors";
import { CourseDetails } from "@/ui/grades/course-card";
import { gradesFixture } from "../fakes/grades";

const calls = vi.hoisted(() => ({
  actor: vi.fn(),
  course: vi.fn(),
  semester: vi.fn(),
  actions: vi.fn(),
  history: vi.fn(),
}));
vi.mock("@/ui/i18n/server", () => ({ getLanguage: async () => "ru" }));
vi.mock("@/app/_lib/get-actor", () => ({ requireStudent: calls.actor }));
vi.mock("@/app/_lib/map-errors", () => ({
  mapPageError: (error: unknown) => {
    throw error;
  },
}));
vi.mock("@/composition/container", () => ({
  grades: {
    getCourseGrades: { execute: calls.course },
    getMyGrades: { executeMessages: calls.semester },
    getCourseActions: { execute: calls.actions },
    getScoreHistory: { execute: calls.history },
  },
}));

function setup() {
  vi.clearAllMocks();
  const d = gradesFixture();
  calls.actor.mockResolvedValue(d.anna);
  calls.history.mockResolvedValue({ entries: [] });
  calls.course.mockImplementation((actor, input) =>
    new GetCourseGrades(d.repository, d.clock).execute(actor, input),
  );
  calls.semester.mockImplementation((actor) =>
    new GetMyGrades(d.repository, d.clock).executeMessages(actor),
  );
  calls.actions.mockImplementation((actor, input) =>
    new GetCourseActions(d.repository, d.clock).execute(actor, input),
  );
  return d;
}

it.each(["abc", "foreign", "missing", "other-course", "repeated"])(
  "страница своей дисциплины игнорирует workId: %s и сохраняет обычные варианты",
  async (kind) => {
    const d = setup();
    const courseId = d.ctx.row("course:fmo:0").id;
    const workId =
      kind === "foreign"
        ? d.ctx.row("assessment:imp:0:0").id
        : kind === "other-course"
          ? d.ctx.row("assessment:fmo:1:0").id
          : kind === "missing"
            ? "00000000-0000-7000-8000-000000ffffee"
            : kind === "repeated"
              ? ["abc", d.ctx.row("assessment:imp:0:0").id]
              : "abc";
    const result = await Page({
      params: Promise.resolve({ courseId }),
      searchParams: Promise.resolve({ actions: "1", workId }),
    });
    expect(calls.actions).toHaveBeenCalledExactlyOnceWith(d.anna, { courseId });
    expect(calls.history).toHaveBeenCalledExactlyOnceWith(d.anna, { courseId });
    const detail = Children.toArray(result.props.children).find(
      (child) => isValidElement(child) && child.type === CourseDetails,
    );
    if (!isValidElement<{ plan: unknown; expandedActions: boolean }>(detail))
      throw new Error("Нет вариантов дисциплины.");
    expect(detail.props.plan).toEqual(
      await new GetCourseActions(d.repository, d.clock).execute(d.anna, {
        courseId,
      }),
    );
    expect(detail.props.expandedActions).toBe(true);
  },
);

it("валидная своя работа передаётся в варианты", async () => {
  const d = setup();
  const courseId = d.ctx.row("course:fmo:0").id;
  const workId = d.ctx.row("assessment:fmo:0:2").id;
  await Page({
    params: Promise.resolve({ courseId }),
    searchParams: Promise.resolve({ workId }),
  });
  expect(calls.actions).toHaveBeenCalledExactlyOnceWith(d.anna, {
    courseId,
    workId,
  });
});

it.each(["foreign", "missing"])(
  "чужая или отсутствующая дисциплина (%s) остаётся NotFound до чтения вариантов",
  async (kind) => {
    const d = setup();
    const courseId =
      kind === "foreign"
        ? d.ctx.row("course:imp:0").id
        : "00000000-0000-7000-8000-000000ffffee";
    await expect(
      Page({
        params: Promise.resolve({ courseId }),
        searchParams: Promise.resolve({ workId: "abc" }),
      }),
    ).rejects.toEqual(new NotFoundError());
    expect(calls.actions).not.toHaveBeenCalled();
    expect(calls.history).not.toHaveBeenCalled();
  },
);
