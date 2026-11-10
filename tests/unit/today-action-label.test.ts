import { expect, it } from "vitest";
import { notificationActionLabel } from "@/ui/notifications/action-label";
import { todayActionLabel } from "@/ui/today/action-label";

it.each(["/schedule", "/schedule?view=week", "/schedule#day"])(
  "уведомление %s ведёт к изменениям, hero сохраняет своё имя",
  (href) => {
    expect(
      todayActionLabel({
        section: "notifications",
        href,
        label: "openNotifications",
      }),
    ).toBe("Посмотреть изменения");
    expect(notificationActionLabel(href)).toBe("Открыть расписание");
  },
);

it.each([
  ["/grades", "Проверить работы"],
  ["/grades/course#work", "Проверить работы"],
  ["/requests/own", "Открыть заявку"],
  ["/schedule-other", "Перейти"],
  ["/notifications", "Открыть уведомления"],
])("уведомление %s получает подпись по смыслу действия", (href, label) => {
  expect(
    todayActionLabel({
      section: "notifications",
      href,
      label: "openNotifications",
    }),
  ).toBe(label);
  if (href.startsWith("/grades"))
    expect(notificationActionLabel(href)).toBe("Открыть успеваемость");
});

it.each(["grades", "requests"] as const)(
  "подписи контекста %s сохраняются",
  (section) => {
    expect(
      todayActionLabel({
        section,
        href: "/schedule",
        label: "openWork",
      }),
    ).toBe("Открыть работу");
  },
);
