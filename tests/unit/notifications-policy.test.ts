import { expect, it } from "vitest";
import {
  groupNotifications,
  isInternalNotificationLink,
} from "@/domain/notifications/quiet-mode";

it("тихий режим: high сверху, normal отдельно, low в дайджесте; новые раньше старых, вход не меняется", () => {
  const items = [
    { id: "1", priority: "normal", createdAt: "2026-11-04T09:00:00.000Z" },
    { id: "2", priority: "low", createdAt: "2026-11-04T12:00:00.000Z" },
    { id: "3", priority: "high", createdAt: "2026-11-04T08:00:00.000Z" },
    { id: "4", priority: "high", createdAt: "2026-11-04T10:00:00.000Z" },
    { id: "5", priority: "normal", createdAt: "2026-11-04T11:00:00.000Z" },
  ] as const;
  const before = structuredClone(items);
  const grouped = groupNotifications(items);
  expect(grouped.high.map((item) => item.id)).toEqual(["4", "3"]);
  expect(grouped.normal.map((item) => item.id)).toEqual(["5", "1"]);
  expect(grouped.digest.map((item) => item.id)).toEqual(["2"]);
  expect(items).toEqual(before);
  expect(groupNotifications([])).toEqual({ high: [], normal: [], digest: [] });
});

it.each([
  "//evil.example",
  "https://evil.example",
  "javascript:alert(1)",
  "\\evil.example",
  "/\\evil.example",
  "/%2fevil.example",
  "/%5cevil.example",
  "/\nevil.example",
  "/\u0000evil",
  " /schedule",
  "",
])("блокирует внешний или неоднозначный путь %j", (link) => {
  expect(isInternalNotificationLink(link)).toBe(false);
});
it.each([
  "/schedule",
  "/grades",
  "/requests/019f0000-0000-7000-8000-000000000001",
  "/schedule?day=2026-11-04#today",
])("разрешает внутренний путь %j", (link) => {
  expect(isInternalNotificationLink(link)).toBe(true);
});
