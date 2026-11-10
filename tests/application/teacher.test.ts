import { expect, it } from "vitest";
import { loginDestination } from "@/application/identity/schemas";
import { ForbiddenError } from "@/application/shared/errors";
import { GetMyLessons } from "@/application/teacher/get-my-lessons";
import type { TeacherLesson } from "@/application/teacher/ports";
import { FakeClock } from "../fakes/clock";
import { anna, marina } from "../fakes/identity";
import {
  FakeTeacherAttendanceRecords,
  FakeTeacherScheduleRepository,
  oleg,
} from "../fakes/teacher";

it("Мои пары: сначала роль, затем только teacherId из Actor, неделя и сегодня по МСК", async () => {
  const repository = new FakeTeacherScheduleRepository();
  const attendance = new FakeTeacherAttendanceRecords();
  const get = new GetMyLessons(
    repository,
    new FakeClock("2026-11-04T22:00:00Z"),
    attendance,
  );
  for (const actor of [anna, marina])
    await expect(get.execute(actor)).rejects.toThrow(ForbiddenError);
  expect(repository.calls).toEqual([]);
  expect(attendance.calls).toEqual([]);
  const data = await get.execute(oleg);
  expect(repository.calls).toEqual([oleg.teacherId]);
  expect(data.today).toBe("2026-11-05");
  expect(data.todayLessons).toEqual([]);
  expect(data.days.map((day) => day.date)).toEqual([
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
    "2026-11-07",
    "2026-11-08",
  ]);
});

it("посещаемость читается внутри use case с teacherId Actor и исходным ключом перенесённой пары", async () => {
  const repository = new FakeTeacherScheduleRepository();
  const attendance = new FakeTeacherAttendanceRecords();
  const lesson: TeacherLesson = {
    id: "slot-id:2026-11-04",
    uid: "slot-id-2026-11-04@pulse",
    date: "2026-11-04",
    startsAt: "2026-11-04T06:00:00Z",
    endsAt: "2026-11-04T07:30:00Z",
    room: "ДЕМО-101",
    teacher: "Учебный преподаватель",
    group: "ДЕМО-1",
    course: "Учебная дисциплина",
    kind: "lecture",
    status: "moved-from",
    changes: [],
    revision: 1,
    updatedAt: "2026-11-04T05:00:00Z",
  };
  repository.lessons.set(oleg.teacherId, [
    lesson,
    {
      ...lesson,
      date: "2026-11-05",
      status: "moved-to",
      startsAt: "2026-11-05T10:00:00Z",
      endsAt: "2026-11-05T11:30:00Z",
    },
  ]);
  const get = new GetMyLessons(
    repository,
    new FakeClock("2026-11-05T09:00:00Z"),
    attendance,
  );
  const result = await get.execute(oleg);
  expect(attendance.calls).toEqual([
    {
      lesson: { slotId: "slot-id", occurrenceDate: "2026-11-04" },
      teacherId: oleg.teacherId,
    },
  ]);
  expect(result.todayLessons[0]?.attendance).toEqual([
    { fullName: "Учебный студент", group: "ДЕМО-1", status: "present" },
  ]);
});

it("каждая роль попадает только на свою главную, next не меняет аудиторию", () => {
  for (const next of [
    null,
    "/today",
    "/staff/requests",
    "/teacher-foreign",
    "//evil.example",
  ])
    expect(loginDestination("teacher", next)).toBe("/teacher");
  expect(loginDestination("teacher", "/teacher?view=week")).toBe(
    "/teacher?view=week",
  );
  expect(loginDestination("student", "/teacher")).toBe("/today");
  expect(loginDestination("staff", "/teacher")).toBe("/staff/requests");
});
