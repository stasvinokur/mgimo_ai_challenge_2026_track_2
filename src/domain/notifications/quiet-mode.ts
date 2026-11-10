export type NotificationKind =
  | "change"
  | "deadline"
  | "request"
  | "news"
  | "alert";
export type NotificationPriority = "high" | "normal" | "low";

export function groupNotifications<
  T extends {
    id: string;
    priority: NotificationPriority;
    createdAt: string;
  },
>(items: readonly T[]) {
  const sorted = [...items].sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
  return {
    high: sorted.filter((item) => item.priority === "high"),
    normal: sorted.filter((item) => item.priority === "normal"),
    digest: sorted.filter((item) => item.priority === "low"),
  };
}

export function isInternalNotificationLink(link: string): boolean {
  return (
    link.startsWith("/") &&
    !link.startsWith("//") &&
    !/[\\\s]/u.test(link) &&
    ![...link].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) &&
    !/%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(link)
  );
}
