import { expect, it } from "vitest";
import {
  certificateDestination,
  isCertificateNumber,
  isVerificationCode,
  maskFullName,
} from "@/domain/certificates/certificate";

it.each(["military", "enrollment", "visa", "scholarship"])(
  "%s выбирает адресата из соответствующего поля",
  (typeCode) => {
    expect(
      certificateDestination(typeCode, {
        office: "Военный комиссариат ДЕМО-района",
        destination: "Учебная организация «ДЕМО»",
      }),
    ).toBe(
      typeCode === "military"
        ? "Военный комиссариат ДЕМО-района"
        : "Учебная организация «ДЕМО»",
    );
  },
);

it.each(["military", "enrollment", "visa", "scholarship"])(
  "%s использует «По месту требования» при пустом адресате",
  (typeCode) => {
    const field = typeCode === "military" ? "office" : "destination";
    const otherField = typeCode === "military" ? "destination" : "office";
    for (const value of [undefined, null, "", " \t\n ", 42]) {
      expect(
        certificateDestination(typeCode, {
          [field]: value,
          [otherField]: "Адресат из другого поля",
        }),
      ).toBe("По месту требования");
    }
  },
);

it.each([
  ["Анна Игоревна Соколова", "Соколова А. И."],
  ["  Тимур   Белов  ", "Белов Т."],
  ["Анна Мария Иванова-Петрова", "Иванова-Петрова А. М."],
  ["Соколова", "Соколова"],
  ["", ""],
])("маскирует %s", (input, expected) =>
  expect(maskFullName(input)).toBe(expected),
);

it("проверяет кириллический номер и канонический base32 из 128 бит", () => {
  expect(isCertificateNumber("С-2026-000045")).toBe(true);
  expect(isCertificateNumber("С-2026-1000000")).toBe(true);
  for (const value of [
    "C-2026-000045",
    "З-2026-000045",
    "С-26-45",
    "С-2026-000045\n",
  ])
    expect(isCertificateNumber(value)).toBe(false);
  for (const last of "AEIMQUY4")
    expect(isVerificationCode("A".repeat(25) + last)).toBe(true);
  for (const value of [
    "a".repeat(26),
    "A".repeat(25),
    "A".repeat(27),
    "0".repeat(26),
    `${"A".repeat(25)}B`,
    `${"A".repeat(26)}\n`,
  ])
    expect(isVerificationCode(value)).toBe(false);
});
