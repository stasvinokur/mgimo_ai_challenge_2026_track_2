import type { Dictionary } from "@/ui/i18n/translate";

export const notificationsMessages = {
  title: { ru: "Уведомления", en: "Notifications" },
  eyebrow: { ru: "Всегда в курсе", en: "Stay up to date" },
  lead: {
    ru: "Важное — сверху, второстепенное — в тихом дайджесте.",
    en: "Important updates first, with less urgent news in a quiet digest.",
  },
  change: { ru: "Изменения", en: "Changes" },
  deadline: { ru: "Дедлайны", en: "Deadlines" },
  request: { ru: "Заявки", en: "Requests" },
  news: { ru: "Новости деканата", en: "Student office news" },
  alert: { ru: "Важное", en: "Important" },
  attention: { ru: "Требует внимания", en: "Needs attention" },
  read: { ru: "Прочитано", en: "Read" },
  unread: { ru: "Новое", en: "New" },
  readAll: { ru: "Прочитать все", en: "Mark all as read" },
  categories: { ru: "Категории уведомлений", en: "Notification categories" },
  all: { ru: "Все", en: "All" },
  retry: { ru: "Повторить", en: "Try again" },
  feed: { ru: "Лента", en: "Feed" },
  quiet: { ru: "Тихий режим", en: "Quiet mode" },
  digest: {
    ru: "Дайджест · {count} · {action}",
    en: "Digest · {count} · {action}",
  },
  collapse: { ru: "Свернуть", en: "Collapse" },
  expand: { ru: "Развернуть", en: "Expand" },
  quietDescription: {
    ru: "Не срочно: прочитайте, когда будет удобно.",
    en: "Nothing urgent: read these when it suits you.",
  },
  empty: { ru: "Пока нет уведомлений", en: "No notifications yet" },
  emptyCategory: {
    ru: "В этой категории пока тихо",
    en: "No updates in this category yet",
  },
  emptyDescription: {
    ru: "Новые изменения и дедлайны появятся здесь. Можно посмотреть другие категории или расписание.",
    en: "New changes and deadlines will appear here. You can explore other categories or check your schedule.",
  },
  schedule: { ru: "Посмотреть расписание", en: "View schedule" },
  showAll: { ru: "Показать все категории", en: "Show all categories" },
  announcements: {
    ru: "Объявления деканата",
    en: "Student office announcements",
  },
  announcementsDescription: {
    ru: "Для вашего курса и группы. Не входят в счётчик непрочитанных.",
    en: "For your year and group. These do not count as unread notifications.",
  },
  announcementsEmpty: {
    ru: "Новых объявлений нет. Загляните сюда позже.",
    en: "No new announcements. Please check again later.",
  },
  russianContent: {
    ru: "Текст уведомления на русском языке.",
    en: "Notification content is available in Russian.",
  },
  russianAnnouncement: {
    ru: "Текст объявления на русском языке.",
    en: "Announcement content is available in Russian.",
  },
  moscowTime: { ru: "МСК", en: "Moscow time" },
  openSchedule: { ru: "Открыть расписание", en: "Open schedule" },
  openGrades: { ru: "Открыть успеваемость", en: "Open grades" },
  openRequest: { ru: "Открыть заявку", en: "Open request" },
  open: { ru: "Перейти", en: "Open" },
  notificationInvalid: {
    ru: "Проверьте данные уведомления.",
    en: "Please check the notification details.",
  },
  notificationLinkUnavailable: {
    ru: "Ссылка недоступна. Откройте нужный раздел через меню.",
    en: "This link is unavailable. Please open the section from the menu.",
  },
  forbidden: {
    ru: "Недостаточно прав для этого действия.",
    en: "Access denied",
  },
  notFound: { ru: "Объект не найден.", en: "Not found" },
  conflict: {
    ru: "Данные изменились. Обновите страницу и попробуйте снова.",
    en: "The details have changed. Please refresh the page.",
  },
  rateLimited: {
    ru: "Слишком много запросов. Попробуйте позже.",
    en: "Too many requests. Please try again later.",
  },
  actionFailed: {
    ru: "Не удалось выполнить действие. Попробуйте снова.",
    en: "We couldn't complete this action. Please try again.",
  },
} as const satisfies Dictionary;
