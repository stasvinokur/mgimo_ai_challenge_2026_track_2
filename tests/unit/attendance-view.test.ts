import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { GetMyGrades } from "@/application/grades/get-my-grades";
import { buildSchedule } from "@/domain/schedule/schedule";
import { StudentAttendance } from "@/ui/attendance/student-summary";
import { TeacherAttendance } from "@/ui/attendance/teacher-screen";
import { GradesView } from "@/ui/grades/grades-view";
import { attendanceKey } from "../fakes/attendance";
import { gradesFixture } from "../fakes/grades";
import { scheduleData } from "../fakes/schedule";

it("студент видит настоящий счёт сверх цели, процент и отдельные уважительные причины; ссылка на пункт 5", () => {
  const html = renderToStaticMarkup(
    createElement(StudentAttendance, {
      data: {
        activityPoints: 23,
        goal: 20,
        courses: [
          {
            id: "course",
            title: "Учебная дисциплина",
            present: 2,
            absent: 1,
            total: 3,
            excused: 2,
            percent: 67,
          },
        ],
      },
    }),
  );
  expect(html).toContain("23 ");
  expect(html).toContain("из 20 — личная цель");
  expect(html).toContain("Был на 2 из 3 · 67%");
  expect(html).toContain("Уважительные причины: 2");
  expect(html).toContain('href="/regulations/attendance#p-5"');
  expect(html).toContain("Баллы не влияют на оценки и стипендию");
  expect(html).not.toMatch(/рейтинг|одногруппник/i);
});
it("пустая посещаемость предлагает дождаться расписания или первой отметки", () => {
  const html = renderToStaticMarkup(
    createElement(StudentAttendance, {
      data: { activityPoints: 0, goal: 20, courses: [] },
    }),
  );
  expect(html).toContain("Занятий пока нет");
  const noMarks = renderToStaticMarkup(
    createElement(StudentAttendance, {
      data: {
        activityPoints: 0,
        goal: 20,
        courses: [
          {
            id: "course",
            title: "Учебная дисциплина",
            present: 0,
            absent: 0,
            total: 0,
            excused: 1,
            percent: null,
          },
        ],
      },
    }),
  );
  expect(noMarks).toContain("Пока отмечены только уважительные причины");
  expect(noMarks).not.toContain("Был на 0 из 0");
  expect(noMarks).not.toContain("0%");
});
it("ростер по умолчанию свёрнут, счётчик виден; закрытие показывается по серверному canClose", () => {
  const lesson = buildSchedule(
    scheduleData(),
    attendanceKey.occurrenceDate,
    attendanceKey.occurrenceDate,
  )[0];
  if (!lesson) throw new Error("Нет учебной пары.");
  const html = renderToStaticMarkup(
    createElement(TeacherAttendance, {
      lessonKey: attendanceKey,
      initial: {
        lesson: { ...lesson, group: "ДЕМО-1" },
        windowOpen: false,
        canClose: true,
        present: 1,
        total: 3,
        roster: [
          {
            fullName: "Студент отметки",
            group: "ДЕМО-1",
            status: "present",
            reason: null,
          },
          {
            fullName: "Участник конкурса",
            group: "ДЕМО-1",
            status: "excused",
            reason: "Учебная олимпиада",
          },
          {
            fullName: "Студент без отметки",
            group: "ДЕМО-1",
            status: "absent",
            reason: null,
          },
        ],
      },
    }),
  );
  expect(html).toContain('role="status"');
  expect(html.replaceAll("\u00a0", " ")).toContain("Отметились 1 из 3");
  expect(html).toContain("1\u00a0из\u00a03");
  const collapsedRoster = html.match(/<details\b([^>]*)>([\s\S]*?)<\/details>/);
  expect(collapsedRoster).not.toBeNull();
  expect(collapsedRoster?.[1]).not.toMatch(/\bopen(?:=|\s|$)/);
  expect(collapsedRoster?.[2]).toContain("Студент отметки · ДЕМО-1");
  expect(html.slice(0, html.indexOf("<details"))).not.toContain(
    "Студент отметки",
  );
  expect(html).toContain("Уважительная причина: Учебная олимпиада");
  expect(html).toContain("Не отмечен");
  expect(html).toContain("Закрыть отметку");
  expect(html).not.toContain("Открыть отметку");
  expect(html).not.toContain("studentId");
});

it("пустые дисциплины сводятся в одну строку, нулевые уважительные причины скрыты", () => {
  const html = renderToStaticMarkup(
    createElement(StudentAttendance, {
      data: {
        activityPoints: 1,
        goal: 20,
        courses: [
          {
            id: "marked",
            title: "Дисциплина с отметкой",
            present: 1,
            absent: 0,
            total: 1,
            excused: 0,
            percent: 100,
          },
          {
            id: "empty-one",
            title: "Пустая дисциплина один",
            present: 0,
            absent: 0,
            total: 0,
            excused: 0,
            percent: null,
          },
          {
            id: "empty-two",
            title: "Пустая дисциплина два",
            present: 0,
            absent: 0,
            total: 0,
            excused: 0,
            percent: null,
          },
        ],
      },
    }),
  );
  expect(html).toContain("Дисциплина с отметкой");
  expect(html).not.toContain("Пустая дисциплина");
  expect(html).not.toContain("Уважительные причины:");
  expect(html).not.toContain("Был на 0 из 0");
  expect(html.match(/По остальным дисциплинам отметок пока нет/g)).toHaveLength(
    1,
  );
});

it("вне серверного окна закрытия кнопка скрыта", () => {
  const lesson = buildSchedule(
    scheduleData(),
    attendanceKey.occurrenceDate,
    attendanceKey.occurrenceDate,
  )[0];
  if (!lesson) throw new Error("Нет учебной пары.");
  const html = renderToStaticMarkup(
    createElement(TeacherAttendance, {
      lessonKey: attendanceKey,
      initial: {
        lesson: { ...lesson, group: "ДЕМО-1" },
        windowOpen: false,
        canClose: false,
        present: 0,
        total: 0,
        roster: [],
      },
    }),
  );
  expect(html).not.toContain("Закрыть отметку");
  expect(html).not.toContain("Открыть отметку");
  expect(html).toContain("В группе пока нет студентов");
});

it("посещаемость находится после сводки и карточек успеваемости", async () => {
  const fixture = gradesFixture();
  const data = await new GetMyGrades(fixture.repository, fixture.clock).execute(
    fixture.anna,
  );
  const html = renderToStaticMarkup(
    createElement(GradesView, {
      data,
      attendance: createElement(
        "section",
        { id: "attendance" },
        "Посещаемость и активность",
      ),
    }),
  );
  expect(html.indexOf("Как у меня дела")).toBeGreaterThan(-1);
  expect(html.indexOf('id="attendance"')).toBeGreaterThan(
    html.indexOf("Как у меня дела"),
  );
  expect(html.indexOf('id="attendance"')).toBeGreaterThan(
    html.indexOf(data.courses[0]?.title ?? ""),
  );
});
