import { expect, it } from "vitest";
import { formatCertificateDate } from "@/application/certificates/format-date";

it.each([
  ["2026-11-03T20:59:59.999Z", "3 ноября 2026 г."],
  ["2026-11-03T21:00:00.000Z", "4 ноября 2026 г."],
  ["2026-12-31T21:00:00.000Z", "1 января 2027 г."],
])("дата справки %s — московская, без ведущего нуля", (input, expected) => {
  expect(formatCertificateDate(input)).toBe(expected);
});
