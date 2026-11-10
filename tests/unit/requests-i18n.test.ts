import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { requestFields } from "@/application/requests/schemas";
import { requestsMessages } from "@/ui/i18n/dictionaries/requests";
import { LanguageProvider } from "@/ui/i18n/language-provider";
import { EventLessonList } from "@/ui/requests/event-lessons";
import { ProfileFields } from "@/ui/requests/profile-fields";
import {
  requestErrorMessage,
  requestFieldError,
  requestFieldTitle,
  requestTypeDescription,
  requestTypeTitle,
} from "@/ui/requests/translations";
import { requestFixtures } from "../../scripts/fixtures/requests";
import { fixtureContext } from "../../scripts/fixtures/shared";
import { FakeClock } from "../fakes/clock";
import { SequentialIdGenerator } from "../fakes/id-generator";

const catalog = requestFixtures(
  fixtureContext(
    new FakeClock("2026-11-05T09:00:00Z"),
    new SequentialIdGenerator(),
  ),
).requestTypes;

const expectedTitles: Record<string, string> = {
  event_release: "Event attendance exemption",
  enrollment: "Certificate of enrolment",
  military: "Military office certificate",
  visa: "Visa certificate",
  scholarship: "Scholarship certificate",
  retake: "Resit request",
  academic_leave: "Academic leave request",
  enrollment_paper: "Stamped paper certificate of enrolment",
  question: "Question for the dean’s office",
};
const expectedFields: Record<string, string> = {
  eventName: "Event name",
  organizer: "Organiser",
  dateFrom: "From date",
  dateTo: "To date",
  eventFormat: "Participation format",
  confirmation: "Confirmation: link or invitation text",
  destination: "Recipient",
  office: "Military registration office",
  country: "Country",
  course: "Course",
  reason: "Reason",
  period: "Requested period",
  question: "Your question",
};

describe("перевод каталога заявок по кодам", () => {
  it("каждый тип демо-каталога и каждое его поле имеют английский перевод", () => {
    expect(catalog.map((type) => type.code).sort()).toEqual(
      Object.keys(expectedTitles).sort(),
    );
    for (const type of catalog) {
      expect(requestTypeTitle("en", type)).toBe(expectedTitles[type.code]);
      expect(requestTypeDescription("en", type)).not.toMatch(/[А-Яа-яЁё]/);
      expect(requestTypeDescription("en", type)).not.toBe(type.description);
      expect(requestTypeTitle("ru", type)).toBe(type.title);
      expect(requestTypeDescription("ru", type)).toBe(type.description);
      for (const field of requestFields(type.fieldsSchema)) {
        expect(requestFieldTitle("en", field)).toBe(expectedFields[field.name]);
        expect(requestFieldTitle("ru", field)).toBe(field.title);
      }
    }
  });

  it("неизвестные типы и поля остаются без изменений, включая специальные ключи", () => {
    for (const code of ["new_request", "constructor", "__proto__"]) {
      const type = {
        code,
        title: "Новый тип из БД",
        description: "Описание из БД",
      };
      const field = { name: code, title: "Новое поле из БД" };
      expect(requestTypeTitle("en", type)).toBe(type.title);
      expect(requestTypeDescription("en", type)).toBe(type.description);
      expect(requestFieldTitle("en", field)).toBe(field.title);
    }
  });

  it("известный код переводится независимо от русского текста в БД", () => {
    expect(
      requestTypeTitle("en", { code: "enrollment", title: "Новое название" }),
    ).toBe(expectedTitles.enrollment);
    expect(
      requestFieldTitle("en", { name: "destination", title: "Иная подпись" }),
    ).toBe("Recipient");
  });
});

describe("коды ошибок формы", () => {
  it("переводит код и параметры, сохраняя прежний русский текст", () => {
    expect(requestFieldError("ru", "requestTooLong", { maxLength: 300 })).toBe(
      "Не больше 300 символов.",
    );
    expect(requestFieldError("en", "requestTooLong", { maxLength: 300 })).toBe(
      "Use no more than 300 characters.",
    );
    expect(requestFieldError("en", "requestDateTooLate")).toContain("60 days");
    expect(requestFieldError("en", "requestDateTooEarly")).toContain("14 days");
    expect(requestFieldError("ru", "Уточните значение.")).toBe(
      "Уточните значение.",
    );
    expect(requestFieldError("en", "Уточните значение.")).toBe(
      "Please check this value.",
    );
  });

  it("общая ошибка использует код и не распознаёт русскую фразу", () => {
    expect(
      requestErrorMessage("en", {
        code: "VALIDATION",
        message: "Другой текст",
      }),
    ).toBe("Please check the completed fields.");
    expect(
      requestErrorMessage("ru", {
        code: "VALIDATION",
        message: "Другой текст",
      }),
    ).toBe("Проверьте заполненные поля.");
    expect(
      requestErrorMessage("en", { code: "UNKNOWN", message: "Русская ошибка" }),
    ).toBe(requestsMessages.error_INTERNAL_ERROR.en);
  });
});

describe("данные и граница языка сотрудника", () => {
  it("английские подписи профиля сохраняют русские данные", () => {
    const props = {
      language: "en" as const,
      children: createElement(ProfileFields, {
        profile: {
          fullName: "Учебный Студент",
          faculty: "Учебный факультет",
          program: "Учебная программа",
          course: 2,
          group: "ДЕМО-2",
          recordBookNo: "ДЕМО-123",
        },
      }),
    };
    const html = renderToStaticMarkup(createElement(LanguageProvider, props));
    expect(html).toContain("Full name");
    expect(html).toContain("Year 2 · ДЕМО-2");
    expect(html).toContain("Учебный Студент");
    expect(html).toContain("Учебный факультет");
  });

  it("список освобождения остаётся русским для сотрудника при English устройства", () => {
    const render = (audience: "student" | "staff") => {
      const props = {
        language: "en" as const,
        children:
          audience === "student"
            ? createElement(EventLessonList, {
                typeCode: "event_release",
                payload: { eventLessons: [] },
                audience,
              })
            : createElement(EventLessonList, {
                typeCode: "event_release",
                payload: { eventLessons: [] },
                audience,
                basis: { section: "4", title: "Учебное положение" },
              }),
      };
      return renderToStaticMarkup(createElement(LanguageProvider, props));
    };
    expect(render("student")).toContain("Classes during the event");
    expect(render("student")).toContain(
      "The regulation is available in Russian.",
    );
    expect(render("staff")).toContain("Пары на время мероприятия");
    expect(render("staff")).toContain("Основание: пункт 4 «Учебное положение»");
    expect(render("staff")).not.toContain("Classes during the event");
  });
});
