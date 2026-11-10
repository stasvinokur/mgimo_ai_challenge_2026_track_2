import type { Dictionary } from "@/ui/i18n/translate";

export const profileMessages = {
  title: { ru: "Профиль", en: "Profile" },
  cabinet: { ru: "Личный кабинет", en: "Student account" },
  lead: {
    ru: "Ваши учебные данные и настройки.",
    en: "Your student details and settings.",
  },
  studentDetails: { ru: "Данные студента", en: "Student details" },
  fullName: { ru: "ФИО", en: "Full name" },
  faculty: { ru: "Факультет", en: "Faculty" },
  program: { ru: "Направление", en: "Programme" },
  course: { ru: "Курс", en: "Year" },
  group: { ru: "Группа", en: "Group" },
  recordBookNo: { ru: "Номер зачётки", en: "Student record number" },
  scholarship: { ru: "Стипендия", en: "Scholarship" },
  none: { ru: "Не назначена", en: "Not awarded" },
  academic: { ru: "Академическая", en: "Academic" },
  increased: { ru: "Повышенная", en: "Enhanced" },
  assistantJournal: {
    ru: "Мой журнал ассистента",
    en: "My assistant journal",
  },
  themeHint: {
    ru: "Тему можно переключить кнопкой вверху страницы.",
    en: "Use the button at the top of the page to switch themes.",
  },
  pushTitle: { ru: "Уведомления на телефон", en: "Phone notifications" },
  pushDescription: {
    ru: "Узнайте о новом статусе заявки, даже когда кабинет закрыт. Все уведомления остаются в кабинете.",
    en: "Get request status updates even when your account is closed. All notifications remain in your account.",
  },
  pushLoading: {
    ru: "Загружаем настройки уведомлений.",
    en: "Loading notification settings.",
  },
  pushRateLimited: {
    ru: "Слишком много попыток. Подождите немного и повторите.",
    en: "Too many attempts. Wait a little and try again.",
  },
  pushSessionEnded: {
    ru: "Сессия завершилась. Войдите в кабинет ещё раз.",
    en: "Your session has ended. Sign in again.",
  },
  pushSaveFailed: {
    ru: "Не удалось сохранить настройку. Попробуйте ещё раз.",
    en: "Could not save the setting. Try again.",
  },
  pushWorkerNotReady: {
    ru: "Сервис уведомлений браузера ещё не готов. Обновите страницу и повторите попытку.",
    en: "The browser notification service is not ready yet. Refresh the page and try again.",
  },
  pushHomeScreen: {
    ru: "На iPhone и iPad добавьте «Пульс» на экран «Домой» через меню «Поделиться», затем откройте приложение оттуда.",
    en: "On iPhone and iPad, add Pulse to your Home Screen using the Share menu, then open the app from there.",
  },
  pushUnsupported: {
    ru: "Этот браузер не поддерживает уведомления на телефон. Уведомления доступны в разделе «Уведомления» кабинета.",
    en: "This browser does not support phone notifications. You can read messages in Notifications in your account.",
  },
  pushNotConfigured: {
    ru: "Уведомления на телефон пока не настроены на сервере. Новые сообщения доступны в разделе «Уведомления» кабинета.",
    en: "Phone notifications are not set up on the server yet. You can read new messages in Notifications in your account.",
  },
  pushDenied: {
    ru: "Уведомления запрещены в настройках браузера. Разрешите их для «Пульса» и обновите страницу.",
    en: "Notifications are blocked in your browser settings. Allow them for Pulse and refresh the page.",
  },
  pushLoadFailed: {
    ru: "Не удалось загрузить настройки. Проверьте подключение и повторите попытку.",
    en: "Could not load settings. Check your connection and try again.",
  },
  pushPermissionRequired: {
    ru: "Разрешение не получено. Разрешите уведомления в браузере и повторите попытку.",
    en: "Permission was not granted. Allow notifications in your browser and try again.",
  },
  pushEnabled: {
    ru: "Уведомления включены на этом устройстве.",
    en: "Notifications are enabled on this device.",
  },
  pushEnableFailed: {
    ru: "Не удалось включить уведомления. Попробуйте ещё раз.",
    en: "Could not enable notifications. Try again.",
  },
  pushDisabled: {
    ru: "Уведомления выключены на этом устройстве.",
    en: "Notifications are disabled on this device.",
  },
  pushTestSent: {
    ru: "Тестовое уведомление отправлено. Если оно не появилось, проверьте настройки уведомлений устройства.",
    en: "Test notification sent. If it does not appear, check your device notification settings.",
  },
  pushTestFailed: {
    ru: "Не удалось доставить проверку. Повторите позже или включите уведомления заново, если подписка отключена.",
    en: "Could not deliver the test notification. Try later, or enable notifications again if your subscription is disabled.",
  },
  pushActionFailed: {
    ru: "Не удалось выполнить действие. Попробуйте ещё раз.",
    en: "Could not complete the action. Try again.",
  },
  pushOn: { ru: "Включены на этом устройстве.", en: "Enabled on this device." },
  pushOff: {
    ru: "Выключены на этом устройстве.",
    en: "Disabled on this device.",
  },
  retry: { ru: "Повторить", en: "Try again" },
  enable: { ru: "Включить", en: "Enable" },
  disable: { ru: "Выключить", en: "Disable" },
  test: { ru: "Проверить", en: "Test" },
} as const satisfies Dictionary;
