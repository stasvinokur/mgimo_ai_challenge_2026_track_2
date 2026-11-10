import type { Dictionary } from "@/ui/i18n/translate";

export const scheduleMessages = {
  title: { ru: "Расписание", en: "Schedule" },
  studyWeek: { ru: "Учебная неделя · {group}", en: "Study week · {group}" },
  introduction: {
    ru: "Все занятия и изменения в одном месте. Время московское.",
    en: "All classes and changes in one place. Times are in Moscow time.",
  },
  view: { ru: "Вид расписания", en: "Schedule view" },
  today: { ru: "Сегодня", en: "Today" },
  todaySuffix: { ru: " · сегодня", en: " · today" },
  week: { ru: "Неделя", en: "Week" },
  selectWeek: { ru: "Выбор недели", en: "Choose a week" },
  previousWeek: { ru: "Предыдущая неделя", en: "Previous week" },
  nextWeek: { ru: "Следующая неделя", en: "Next week" },
  currentWeek: { ru: "К текущей неделе", en: "Go to current week" },
  lecture: { ru: "Лекция", en: "Lecture" },
  seminar: { ru: "Семинар", en: "Seminar" },
  exam: { ru: "Экзамен", en: "Exam" },
  moved: { ru: "Перенос", en: "Rescheduled" },
  room: { ru: "Смена аудитории", en: "Room changed" },
  cancelled: { ru: "Отмена занятия", en: "Class cancelled" },
  replaced: { ru: "Замена преподавателя", en: "Teacher changed" },
  movedTo: { ru: "Перенесено на {moment}", en: "Rescheduled to {moment}" },
  movedFrom: { ru: "Перенесено с {moment}", en: "Rescheduled from {moment}" },
  before: { ru: "Было: ", en: "Before: " },
  after: { ru: "стало:", en: "after:" },
  roomLabel: { ru: "Ауд. {room}", en: "Room {room}" },
  moment: {
    ru: "{date}, {start}–{end}, ауд. {room}",
    en: "{date}, {start}–{end}, room {room}",
  },
  cancellation: { ru: "занятие отменено", en: "class cancelled" },
  reason: { ru: "Причина: {reason}", en: "Reason: {reason}" },
  inProgress: { ru: "Идёт сейчас", en: "In progress" },
  inMinutes: { ru: "Через {minutes} мин", en: "In {minutes} min" },
  currentClass: {
    ru: "Сейчас: {course} · до {end}",
    en: "Now: {course} · until {end}",
  },
  nextClass: {
    ru: "Следующая пара через {minutes} мин: {course}, ауд. {room}.",
    en: "Next class in {minutes} min: {course}, room {room}.",
  },
  noMoreClasses: {
    ru: "На сегодня больше нет запланированных пар.",
    en: "No more classes are scheduled for today.",
  },
  todayChanges: {
    ru: "Есть изменения на сегодня — проверьте карточки ниже.",
    en: "There are changes today — check the cards below.",
  },
  noClasses: { ru: "Занятий нет", en: "No classes" },
  nextStudyDay: {
    ru: "Ближайший учебный день — {date}.",
    en: "Your next study day is {date}.",
  },
  restOrBrowse: {
    ru: "Можно отдохнуть или посмотреть занятия другой недели.",
    en: "Take a break or check classes for another week.",
  },
  goToNextStudyDay: {
    ru: "К ближайшему учебному дню",
    en: "Go to next study day",
  },
  invalidWeek: {
    ru: "Не удалось выбрать неделю. Используйте формат ГГГГ-WНН, например 2026-W45.",
    en: "Could not select the week. Use YYYY-Www, for example 2026-W45.",
  },
  goToToday: { ru: "К расписанию на сегодня", en: "Go to today's schedule" },
  calendarTitle: { ru: "Личный календарь", en: "Personal calendar" },
  calendarDescription: {
    ru: "Подписка на текущую и три следующие недели с учётом изменений. Сохраните ссылку в своём календаре. Она открывает доступ к расписанию без входа — храните её у себя.",
    en: "Subscribe to this week and the next three weeks, including changes. Save the link in your calendar. It gives access to your schedule without signing in — keep it private.",
  },
  calendarCreating: { ru: "Создаём ссылку…", en: "Creating link…" },
  calendarRenew: { ru: "Перевыпустить ссылку", en: "Replace link" },
  calendarCreate: { ru: "Получить новую ссылку", en: "Get a new link" },
  calendarRevokeNotice: {
    ru: "При создании новой ссылки предыдущая перестанет работать.",
    en: "Creating a new link will deactivate the previous one.",
  },
  calendarUrl: { ru: "Ссылка для подписки", en: "Subscription link" },
  calendarDownload: { ru: "Скачать файл .ics", en: "Download .ics file" },
  calendarRetry: {
    ru: "Нажмите кнопку ещё раз.",
    en: "Press the button to try again.",
  },
  NOT_FOUND: { ru: "Объект не найден.", en: "Item not found." },
  FORBIDDEN: {
    ru: "Недостаточно прав для этого действия.",
    en: "You do not have permission.",
  },
  VALIDATION: {
    ru: "Проверьте заполненные поля.",
    en: "Check the entered details.",
  },
  CONFLICT: {
    ru: "Данные изменились. Обновите страницу и попробуйте снова.",
    en: "The details have changed. Refresh the page.",
  },
  RATE_LIMITED: {
    ru: "Слишком много запросов. Попробуйте позже.",
    en: "Too many requests. Please try again later.",
  },
  INTERNAL_ERROR: {
    ru: "Не удалось выполнить действие. Попробуйте снова.",
    en: "Could not complete the action. Please try again.",
  },
} as const satisfies Dictionary;
