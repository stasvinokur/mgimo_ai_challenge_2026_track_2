export type DayInterval = {
  start: number;
  end: number;
  title: string;
};

export type DayTimelineInput = {
  intervals: readonly DayInterval[];
  dayStart: number;
  dayEnd: number;
  now: number;
  width: number;
};

type Point = { x: number; y: number };
type Label = { x: number; width: number; text: string; time: number };
const baseline = 52;
const labelGap = 8;
const timeWidth = 34;
const timeFormat = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  hour: "2-digit",
  minute: "2-digit",
});
const formatTime = (time: number) => timeFormat.format(time);
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function layoutDayTimeline({
  intervals,
  dayStart,
  dayEnd,
  now,
  width,
}: DayTimelineInput) {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const padding = Math.min(12, safeWidth / 4);
  const left = padding;
  const right = safeWidth - padding;
  const validDay =
    Number.isFinite(dayStart) && Number.isFinite(dayEnd) && dayEnd > dayStart;
  const visible = validDay
    ? intervals
        .filter(
          (item) =>
            Number.isFinite(item.start) &&
            Number.isFinite(item.end) &&
            item.end > item.start &&
            item.start < dayEnd &&
            item.end > dayStart,
        )
        .map((item) => ({
          ...item,
          start: Math.max(dayStart, item.start),
          end: Math.min(dayEnd, item.end),
        }))
        .sort((a, b) => a.start - b.start || a.end - b.end)
    : [];
  const xAt = (time: number) =>
    validDay
      ? left +
        ((clamp(time, dayStart, dayEnd) - dayStart) / (dayEnd - dayStart)) *
          (right - left)
      : left;
  const points: Point[] = [{ x: left, y: baseline }];
  visible.forEach((item, index) => {
    const next = visible[index + 1];
    const start = xAt(item.start);
    const end = xAt(Math.min(item.end, next?.start ?? dayEnd));
    if (end <= start) return;
    const span = end - start;
    points.push(
      { x: start, y: baseline },
      { x: start + span * 0.15, y: 34 },
      { x: start + span * 0.35, y: 70 },
      { x: start + span * 0.6, y: 16 },
      { x: start + span * 0.8, y: baseline },
      { x: end, y: baseline },
    );
  });
  points.push({ x: right, y: baseline });
  const markerX = validDay && Number.isFinite(now) ? xAt(now) : null;
  let marker: Point | null =
    markerX === null ? null : { x: markerX, y: baseline };
  if (marker) {
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1];
      const b = points[index];
      if (a && b && b.x > a.x && marker.x >= a.x && marker.x <= b.x) {
        marker = {
          x: marker.x,
          y: a.y + ((marker.x - a.x) / (b.x - a.x)) * (b.y - a.y),
        };
        break;
      }
    }
  }
  const labels: Label[] = [];
  if (validDay && right - left >= timeWidth) {
    labels.push({
      x: left,
      width: timeWidth,
      text: formatTime(dayStart),
      time: dayStart,
    });
    const endLabelX = right - timeWidth;
    const reserveEnd = endLabelX >= left + timeWidth + labelGap;
    const limit = reserveEnd ? endLabelX - labelGap : right;
    for (const item of visible) {
      if (
        item.start === dayStart ||
        labels.some((label) => label.time === item.start)
      )
        continue;
      const previous = labels.at(-1);
      const minX = previous ? previous.x + previous.width + labelGap : left;
      const title = item.title.trim();
      const fullText = `${formatTime(item.start)} · ${title}`;
      const fullWidth = fullText.length * 7;
      const available = limit - minX;
      const showTitle = title.length > 0 && fullWidth <= available;
      const labelWidth = showTitle ? fullWidth : timeWidth;
      if (labelWidth > available) continue;
      const x = clamp(
        xAt(item.start) - labelWidth / 2,
        minX,
        limit - labelWidth,
      );
      labels.push({
        x,
        width: labelWidth,
        text: showTitle ? fullText : formatTime(item.start),
        time: item.start,
      });
    }
    if (reserveEnd)
      labels.push({
        x: endLabelX,
        width: timeWidth,
        text: formatTime(dayEnd),
        time: dayEnd,
      });
  }
  const summary = validDay
    ? [
        `День с ${formatTime(dayStart)} до ${formatTime(dayEnd)}.`,
        visible.length
          ? visible
              .map(
                (item) =>
                  `${formatTime(item.start)}–${formatTime(item.end)} — ${item.title}.`,
              )
              .join(" ")
          : "Занятий нет.",
        Number.isFinite(now)
          ? `Сейчас ${formatTime(now)}${now < dayStart ? ", до начала дня" : now > dayEnd ? ", после конца дня" : ""}.`
          : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "Линия дня недоступна: проверьте границы дня.";
  return { width: safeWidth, height: 100, points, marker, labels, summary };
}
