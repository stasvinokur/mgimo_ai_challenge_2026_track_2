import { describe, expect, it } from "vitest";
import {
  addDays,
  dateFromWeek,
  isoWeek,
  moscowDate,
} from "@/domain/schedule/dates";
import { renderCalendar } from "@/domain/schedule/ics";
import { buildSchedule, daySummary } from "@/domain/schedule/schedule";
import { FakeClock } from "../fakes/clock";
import { change, scheduleData, slot } from "../fakes/schedule";

describe("московские даты и ISO-недели", () => {
  it("меняет день в полночь Москвы, включая границу года и 53 неделю", () => {
    expect(moscowDate(new Date("2026-11-01T21:00:00Z"))).toBe("2026-11-02");
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    expect(dateFromWeek("2026-W53")).toBe("2026-12-28");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("недельный шаблон и изменения", () => {
  it("учитывает чётность ISO-недели и разные типы занятий", () => {
    const data = scheduleData({
      slots: [
        { ...slot, weekParity: "odd" },
        { ...slot, id: "even", kind: "seminar", weekParity: "even" },
      ],
    });
    expect(
      buildSchedule(data, "2026-11-02", "2026-11-08").map((l) => l.id),
    ).toEqual(["slot-anna:2026-11-02"]);
    expect(buildSchedule(data, "2026-11-09", "2026-11-15")[0]?.kind).toBe(
      "seminar",
    );
  });

  it("показывает перенос в исходном и новом слотах, не затрагивает следующую неделю", () => {
    const lessons = buildSchedule(
      scheduleData({ changes: [change()] }),
      "2026-11-02",
      "2026-11-09",
    );
    expect(lessons.map((l) => [l.status, l.startsAt, l.room])).toEqual([
      ["moved-from", "2026-11-02T06:00:00.000Z", "405"],
      ["moved-to", "2026-11-02T10:00:00.000Z", "312"],
      ["scheduled", "2026-11-09T06:00:00.000Z", "405"],
    ]);
    expect(lessons[0]?.uid).toBe(lessons[1]?.uid);
    expect(lessons[1]?.changes[0]).toMatchObject({
      before: { room: "405" },
      after: { room: "312" },
    });
  });

  it("подтягивает перенос из другой недели, сохраняя время при переносе только даты", () => {
    const data = scheduleData({
      changes: [
        change({ newDate: "2026-11-10", newStartsAt: null, newEndsAt: null }),
      ],
    });
    const lessons = buildSchedule(data, "2026-11-09", "2026-11-15");
    expect(lessons).toHaveLength(2);
    expect(lessons[1]).toMatchObject({
      status: "moved-to",
      startsAt: "2026-11-10T06:00:00.000Z",
      endsAt: "2026-11-10T07:30:00.000Z",
    });
    expect(buildSchedule(data, "2026-11-02", "2026-11-08")).toMatchObject([
      { status: "moved-from" },
    ]);
  });

  it.each(["room", "replaced", "cancelled"] as const)(
    "применяет %s, причину и значения было/стало",
    (kind) => {
      const lessons = buildSchedule(
        scheduleData({
          changes: [
            change({
              kind,
              newDate: null,
              newStartsAt: null,
              newEndsAt: null,
              newTeacher: kind === "replaced" ? "Нина Береговая" : null,
            }),
          ],
        }),
        "2026-11-02",
        "2026-11-08",
      );
      expect(lessons).toHaveLength(1);
      expect(lessons[0]?.startsAt).toBe("2026-11-02T06:00:00.000Z");
      expect(lessons[0]?.changes[0]?.reason).toBeTruthy();
      expect(lessons[0]?.changes[0]?.before.room).toBe("405");
      expect(lessons[0]?.changes[0]?.after.room).toBe("312");
      if (kind === "cancelled") expect(lessons[0]?.status).toBe("cancelled");
      if (kind === "replaced")
        expect(lessons[0]?.teacher).toBe("Нина Береговая");
    },
  );

  it("применяет несколько изменений в хронологическом порядке", () => {
    const data = scheduleData({
      changes: [
        change({
          id: "room",
          kind: "room",
          newDate: null,
          newStartsAt: null,
          newEndsAt: null,
          newRoom: "411",
          createdAt: "2026-11-02T08:00:00.000Z",
        }),
        change(),
      ],
    });
    const lesson = buildSchedule(data, "2026-11-02", "2026-11-02")[1];
    expect(lesson?.startsAt).toBe("2026-11-02T10:00:00.000Z");
    expect(lesson?.room).toBe("411");
    expect(lesson?.changes[1]?.before.room).toBe("312");
  });
});

it("на управляемых часах выбирает текущую/следующую, исключая старый и отменённый слот", () => {
  const clock = new FakeClock("2026-11-02T06:00:00Z");
  const lessons = buildSchedule(
    scheduleData({ changes: [change()] }),
    "2026-11-02",
    "2026-11-16",
  );
  expect(daySummary(lessons, "2026-11-02", clock.now())).toMatchObject({
    current: null,
    next: { room: "312" },
    minutesUntilNext: 240,
  });
  clock.set("2026-11-02T10:00:00Z");
  expect(daySummary(lessons, "2026-11-02", clock.now()).current?.status).toBe(
    "moved-to",
  );
  clock.set("2026-11-02T11:30:00Z");
  expect(daySummary(lessons, "2026-11-02", clock.now())).toMatchObject({
    current: null,
    nextStudyDate: "2026-11-09",
  });
  const cancelled = buildSchedule(
    scheduleData({ changes: [change({ kind: "cancelled" })] }),
    "2026-11-02",
    "2026-11-02",
  );
  expect(daySummary(cancelled, "2026-11-02", clock.now()).next).toBeNull();
});

it("ICS: RFC-структура, UTF-8 folding, CRLF, экранирование, стабильный UID и UTC", () => {
  const data = scheduleData({
    slots: [
      {
        ...slot,
        course: `${"Длинное название ".repeat(10)}; тест, \\ строка\nновая`,
      },
    ],
    changes: [change()],
  });
  const calendar = renderCalendar(
    buildSchedule(data, "2026-11-02", "2026-11-08"),
  );
  expect(calendar).not.toMatch(/(?<!\r)\n|\r(?!\n)/);
  for (const line of calendar.split("\r\n"))
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  const parsed = parseIcs(calendar);
  expect(parsed).toHaveLength(1);
  expect(parsed[0]).toMatchObject({
    UID: "slot-anna-2026-11-02@pulse",
    DTSTART: "20261102T100000Z",
    DTEND: "20261102T113000Z",
    LOCATION: "312",
    STATUS: "CONFIRMED",
    SUMMARY: data.slots[0]?.course,
  });
  const unchanged = parseIcs(
    renderCalendar(buildSchedule(scheduleData(), "2026-11-02", "2026-11-08")),
  );
  expect(parsed[0]?.UID).toBe(unchanged[0]?.UID);
  const cancelled = parseIcs(
    renderCalendar(
      buildSchedule(
        scheduleData({ changes: [change({ kind: "cancelled" })] }),
        "2026-11-02",
        "2026-11-08",
      ),
    ),
  );
  expect(cancelled[0]?.STATUS).toBe("CANCELLED");
});

// Independent content-line parser validates required RFC 5545 event properties.
function parseIcs(input: string): Record<string, string>[] {
  const lines = input
    .replace(/\r\n[ \t]/g, "")
    .split("\r\n")
    .filter(Boolean);
  expect(lines.shift()).toBe("BEGIN:VCALENDAR");
  expect(lines.pop()).toBe("END:VCALENDAR");
  expect(lines).toContain("VERSION:2.0");
  const events: Record<string, string>[] = [];
  let event: Record<string, string> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      expect(event).toBeNull();
      event = {};
      continue;
    }
    if (line === "END:VEVENT") {
      expect(event).toHaveProperty("UID");
      for (const key of ["DTSTAMP", "DTSTART", "DTEND"])
        expect(event?.[key]).toMatch(/^\d{8}T\d{6}Z$/);
      expect(event?.DTEND?.localeCompare(event.DTSTART ?? "")).toBe(1);
      if (event) events.push(event);
      event = null;
      continue;
    }
    const property = /^([A-Z-]+)(?:;[^:]*)?:(.*)$/.exec(line);
    expect(property, "Некорректная content-line").not.toBeNull();
    if (event && property?.[1])
      event[property[1]] = (property[2] ?? "").replace(
        /\\([nN,;\\])/g,
        (_, value: string) => (value.toLowerCase() === "n" ? "\n" : value),
      );
  }
  expect(event).toBeNull();
  return events;
}
