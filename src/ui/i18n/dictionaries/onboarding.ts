import type { Dictionary } from "@/ui/i18n/translate";

export const onboardingMessages = {
  title: { ru: "Первые шаги", en: "First steps" },
  hide: { ru: "Скрыть", en: "Hide" },
  hideDetail: { ru: " первые шаги", en: " first steps" },
  introduction: {
    ru: "Освойтесь в кабинете в своём темпе. Прогресс сохранится после выхода.",
    en: "Explore your cabinet at your own pace. Your progress is saved when you sign out.",
  },
  progress: { ru: "{completed} из {total}", en: "{completed} of {total}" },
  schedule: {
    ru: "Посмотреть неделю расписания",
    en: "View your weekly timetable",
  },
  calendar: {
    ru: "Подписать расписание на календарь",
    en: "Subscribe to your timetable calendar",
  },
  install: {
    ru: "Установить «Пульс» на телефон",
    en: "Install Pulse on your phone",
  },
  regulations: {
    ru: "Найти положение о стипендии",
    en: "Find the scholarship regulations",
  },
  assistant: {
    ru: "Задать вопрос ассистенту",
    en: "Ask the assistant a question",
  },
  push: {
    ru: "Включить уведомления на телефон",
    en: "Enable phone notifications",
  },
  passkey: { ru: "Добавить ключ доступа", en: "Add a passkey" },
  automatic: {
    ru: "Отметится автоматически",
    en: "Completes automatically",
  },
  completed: { ru: "Выполнено", en: "Completed" },
  done: { ru: "Готово", en: "Done" },
  allDone: {
    ru: "Всё готово! Карточку можно скрыть.",
    en: "All set! You can hide this card.",
  },
  saving: { ru: "Сохраняем…", en: "Saving…" },
  saveError: {
    ru: "Не удалось сохранить прогресс. Попробуйте ещё раз.",
    en: "Your progress could not be saved. Please try again.",
  },
  retry: { ru: "Повторить", en: "Try again" },
  installPageTitle: {
    ru: "Установка на телефон",
    en: "Install on your phone",
  },
  installIntroduction: {
    ru: "Подсказка установки появится над этой страницей, если браузер поддерживает установку. Следуйте её инструкциям.",
    en: "An installation prompt will appear above this page if your browser supports installation. Follow its instructions.",
  },
  installHelp: {
    ru: "Если подсказки нет, откройте меню браузера и найдите добавление на главный экран. Если приложение уже на телефоне, вернитесь к первым шагам и отметьте установку.",
    en: "If there is no prompt, open your browser menu and look for Add to Home Screen. If the app is already on your phone, return to First steps and mark installation as done.",
  },
  backToSteps: { ru: "К первым шагам", en: "Back to first steps" },
} as const satisfies Dictionary;
