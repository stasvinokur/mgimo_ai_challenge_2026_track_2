import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import AttendanceError from "@/app/attend/error";
import { AttendanceConfirmation } from "@/ui/attendance/confirmation";
import { StudentAttendance } from "@/ui/attendance/student-summary";
import { attendanceMessages } from "@/ui/i18n/dictionaries/attendance";
import type { Language } from "@/ui/i18n/language";
import { LanguageProvider } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";

vi.mock("@/app/attend/actions", () => ({ markAttendance: vi.fn() }));

function render(language: Language, children: ReactNode) {
  return renderToStaticMarkup(
    createElement(LanguageProvider, { language, children }),
  );
}

it("закрытые коды отметки переводятся с параметрами без готовой фразы из use case", () => {
  expect(t("en", attendanceMessages, "invalidCode")).toBe(
    "This code is invalid or has expired",
  );
  expect(t("en", attendanceMessages, "alreadyPresent")).toBe(
    "You have already checked in",
  );
  expect(t("en", attendanceMessages, "marked", { points: 1 })).toBe(
    "Checked in ✓ · +1 activity point",
  );
  expect(t("ru", attendanceMessages, "marked", { points: 1 })).toBe(
    "Отмечено ✓ · +1 балл активности",
  );
});

it("английская сводка сохраняет название из БД, фактические баллы и исключает уважительные причины из процента", () => {
  const html = render(
    "en",
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
  expect(html).toContain("Attendance and activity");
  expect(html).toContain("Учебная дисциплина");
  expect(html).toContain("23 ");
  expect(html).toContain("of 20 — personal goal");
  expect(html).toContain("Attended 2 of 3 · 67%");
  expect(html).toContain(
    "Excused absences: 2. Excluded from the attendance percentage.",
  );
  expect(html).toContain("do not affect grades or your scholarship");
});

it("подтверждение переводит состояния и экранирует исходное название дисциплины", () => {
  const valid = render(
    "en",
    createElement(AttendanceConfirmation, {
      code: "a".repeat(22),
      confirmation: {
        valid: true,
        course: "Дисциплина <script>",
        alreadyPresent: false,
      },
    }),
  );
  expect(valid).toContain("Class check-in");
  expect(valid).toContain("Check in for “Дисциплина &lt;script&gt;”?");
  expect(valid).toContain('data-attendance-ready="false"');
  expect(valid).toContain("My attendance and points");
  expect(valid).not.toContain("Дисциплина <script>");
  const invalid = render(
    "en",
    createElement(AttendanceConfirmation, {
      code: "a".repeat(22),
      confirmation: { valid: false, messageCode: "invalidCode" },
    }),
  );
  expect(invalid).toContain("This code is invalid or has expired");
  expect(invalid).not.toContain("<form");
  const already = render(
    "en",
    createElement(AttendanceConfirmation, {
      code: "a".repeat(22),
      confirmation: { valid: true, course: "Курс", alreadyPresent: true },
    }),
  );
  expect(already).toContain("You have already checked in");
  expect(already).not.toContain("<form");
});

it("пустое и ошибочное состояния доступны на английском", () => {
  expect(
    render(
      "en",
      createElement(StudentAttendance, {
        data: { activityPoints: 0, goal: 20, courses: [] },
      }),
    ),
  ).toContain("No classes yet.");
  const html = render("en", createElement(AttendanceError, { reset: vi.fn() }));
  expect(html).toContain("Could not load the page");
  expect(html).toContain("Try again");
  expect(html).toContain('role="alert"');
});
