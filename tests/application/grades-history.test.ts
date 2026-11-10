import { describe, expect, it, vi } from "vitest";
import {
  GetScoreHistory,
  type ScoreHistoryRepository,
} from "@/application/grades/history";
import type { Actor } from "@/application/ports/actor";
import { ForbiddenError, NotFoundError } from "@/application/shared/errors";
import { gradesFixture } from "../fakes/grades";

function fixture() {
  const grades = gradesFixture();
  const listForStudentCourse = vi
    .fn<ScoreHistoryRepository["listForStudentCourse"]>()
    .mockResolvedValue([]);
  return {
    ...grades,
    listForStudentCourse,
    get: new GetScoreHistory(grades.repository, { listForStudentCourse }),
  };
}

describe("История баллов текущего студента", () => {
  it("передаёт владельца из Actor, возвращает сериализуемые записи и пустую историю", async () => {
    const f = fixture();
    const courseId = f.ctx.row("course:fmo:0").id;
    expect(await f.get.execute(f.anna, { courseId })).toEqual({ entries: [] });
    expect(f.listForStudentCourse).toHaveBeenLastCalledWith(
      courseId,
      f.ctx.row("student:anna").id,
    );
    const entry = {
      id: "event",
      assessmentTitle: "Учебный тест",
      previousScore: 70,
      newScore: 80,
      reason: "retake",
      createdAt: "2026-11-05T12:00:00.000Z",
    };
    f.listForStudentCourse.mockResolvedValue([entry]);
    const data = await f.get.execute(f.anna, { courseId });
    expect(data.entries).toEqual([{ ...entry, reason: "retake" }]);
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it("не раскрывает произвольную причину из старой записи", async () => {
    const f = fixture();
    const courseId = f.ctx.row("course:fmo:0").id;
    const rawReason = "Старый произвольный текст";
    f.listForStudentCourse.mockResolvedValue([
      {
        id: "old-event",
        assessmentTitle: "Учебный тест",
        previousScore: 70,
        newScore: 80,
        reason: rawReason,
        createdAt: "2026-11-05T12:00:00.000Z",
      },
    ]);
    const data = await f.get.execute(f.anna, { courseId });
    expect(data.entries[0]?.reason).toBe("clarification");
    expect(JSON.stringify(data)).not.toContain(rawReason);
  });

  it("чужой и отсутствующий курс дают одинаковый NotFound до чтения истории", async () => {
    const f = fixture();
    for (const courseId of [
      f.ctx.row("course:imp:0").id,
      "00000000-0000-7000-8000-000000ffffee",
      "invalid",
    ]) {
      await expect(f.get.execute(f.anna, { courseId })).rejects.toThrow(
        NotFoundError,
      );
    }
    expect(f.listForStudentCourse).not.toHaveBeenCalled();
  });

  it.each(["studentId", "userId", "groupId"])(
    "не принимает %s клиента",
    async (key) => {
      const f = fixture();
      await expect(
        f.get.execute(f.anna, {
          courseId: f.ctx.row("course:fmo:0").id,
          [key]: "foreign",
        }),
      ).rejects.toThrow(NotFoundError);
      expect(f.repository.calls).toHaveLength(0);
      expect(f.listForStudentCourse).not.toHaveBeenCalled();
    },
  );

  it.each<Actor>([
    { kind: "teacher", userId: "teacher", teacherId: "teacher" },
    { kind: "staff", userId: "staff", staffId: "staff", facultyIds: [] },
  ])("запрещает другой роли чтение до репозитория", async (actor) => {
    const f = fixture();
    await expect(f.get.execute(actor, {})).rejects.toThrow(ForbiddenError);
    expect(f.repository.calls).toHaveLength(0);
    expect(f.listForStudentCourse).not.toHaveBeenCalled();
  });
});
