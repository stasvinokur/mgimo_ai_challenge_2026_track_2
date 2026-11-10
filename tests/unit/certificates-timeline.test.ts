import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { type RequestStatus, typeDto } from "@/application/requests/dto";
import type { RequestDetailDto } from "@/application/requests/queries";
import { RequestTimeline } from "@/ui/requests/request-timeline";
import { enrollmentType } from "../fakes/requests";

const request: RequestDetailDto = {
  id: "certificate-request",
  publicNo: "З-2026-000045",
  type: typeDto(enrollmentType),
  payload: {},
  status: "ready",
  assignee: null,
  submittedAt: "2026-11-04T12:00:00.000Z",
  dueAt: null,
  createdAt: "2026-11-04T12:00:00.000Z",
  updatedAt: "2026-11-04T12:00:00.000Z",
  sla: null,
  events: [],
};

it.each([
  [undefined, "ready", true, false],
  [false, "issued", true, false],
  [true, "ready", true, true],
  [true, "issued", true, true],
  [true, "in_progress", true, false],
  [true, "ready", false, false],
] satisfies [boolean | undefined, RequestStatus, boolean, boolean][])(
  "скачивание: canDownload=%s, status=%s, certificate=%s → %s",
  (canDownload, status, isCertificate, visible) => {
    const html = renderToStaticMarkup(
      createElement(RequestTimeline, {
        request: {
          ...request,
          status,
          type: { ...request.type, isCertificate },
        },
        canDownload,
      }),
    );
    expect(html.includes("Скачать справку (PDF)")).toBe(visible);
    expect(html.includes('href="/api/requests/certificate-request/pdf"')).toBe(
      visible,
    );
  },
);
