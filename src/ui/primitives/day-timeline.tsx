"use client";

import { useEffect, useRef, useState } from "react";
import {
  type DayTimelineInput,
  layoutDayTimeline,
} from "./day-timeline-layout";
import { cn } from "./utils";

export function DayTimeline({
  className,
  ...input
}: Omit<DayTimelineInput, "width"> & { className?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const layout = layoutDayTimeline({ ...input, width });
  return (
    <div ref={container} className={cn("day-timeline", className)}>
      {width > 0 && (
        <svg
          viewBox={`0 0 ${width} ${layout.height}`}
          aria-hidden="true"
          focusable="false"
        >
          <polyline
            points={layout.points.map(({ x, y }) => `${x},${y}`).join(" ")}
          />
          {layout.marker && (
            <g className="day-timeline-now">
              <circle
                cx={layout.marker.x}
                cy={layout.marker.y}
                r="10"
                fill="none"
              />
              <circle
                cx={layout.marker.x}
                cy={layout.marker.y}
                r="4"
                className="day-timeline-dot"
              />
            </g>
          )}
          {layout.labels.map((label) => (
            <text
              key={label.time}
              x={label.x}
              y="92"
              textLength={label.width}
              lengthAdjust="spacingAndGlyphs"
            >
              {label.text}
            </text>
          ))}
        </svg>
      )}
      <p className="sr-only">{layout.summary}</p>
    </div>
  );
}
