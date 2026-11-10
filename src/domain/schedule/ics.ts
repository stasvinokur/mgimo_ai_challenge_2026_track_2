import type { Lesson } from "./schedule";

function escapeText(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}

function timestamp(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function fold(line: string): string {
  const lines: string[] = [];
  let part = "";
  let bytes = 0;
  for (const character of line) {
    const size =
      (character.codePointAt(0) ?? 0) <= 0x7f
        ? 1
        : (character.codePointAt(0) ?? 0) <= 0x7ff
          ? 2
          : (character.codePointAt(0) ?? 0) <= 0xffff
            ? 3
            : 4;
    if (bytes + size > 75) {
      lines.push(part);
      part = " ";
      bytes = 1;
    }
    part += character;
    bytes += size;
  }
  lines.push(part);
  return lines.join("\r\n");
}

export function renderCalendar(lessons: Lesson[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pulse//Schedule//RU",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Пульс — расписание",
  ];
  for (const lesson of lessons) {
    if (lesson.status === "moved-from") continue;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${lesson.uid}`,
      `DTSTAMP:${timestamp(lesson.updatedAt)}`,
      `LAST-MODIFIED:${timestamp(lesson.updatedAt)}`,
      `SEQUENCE:${lesson.revision}`,
      `DTSTART:${timestamp(lesson.startsAt)}`,
      `DTEND:${timestamp(lesson.endsAt)}`,
      `SUMMARY:${escapeText(lesson.course)}`,
      `LOCATION:${escapeText(lesson.room)}`,
      `DESCRIPTION:${escapeText([lesson.teacher, ...lesson.changes.map((c) => c.reason)].join("\n"))}`,
      `STATUS:${lesson.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
