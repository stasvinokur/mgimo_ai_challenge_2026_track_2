import type { Dictionary } from "@/ui/i18n/translate";

export const certificatesMessages = {
  ready: { ru: "Готовая справка", en: "Certificate ready" },
  qr: {
    ru: "QR-код проверки справки {number}",
    en: "QR code to verify certificate {number}",
  },
  issuedOn: { ru: "{type} · выдана {date}", en: "{type} · issued {date}" },
  revoked: { ru: "Справка отозвана", en: "Certificate revoked" },
  verification: {
    ru: "Проверка подлинности по QR",
    en: "Verify authenticity by QR code",
  },
  download: { ru: "Скачать PDF", en: "Download PDF" },
  downloadCertificate: {
    ru: "Скачать справку (PDF)",
    en: "Download certificate (PDF)",
  },
  link: { ru: "Ссылка", en: "Link" },
  copied: { ru: "Ссылка скопирована", en: "Link copied" },
  copyFailed: {
    ru: "Не удалось скопировать. Выделите и скопируйте адрес:",
    en: "Could not copy the link. Select and copy the address:",
  },
  concept: {
    ru: "Вымышленный документ конкурсного концепта MGIMO×AI Challenge. Не является официальным документом.",
    en: "A fictional document for the MGIMO×AI Challenge competition concept. This is not an official document.",
  },
  russianDocument: {
    ru: "PDF-справка и заявка для деканата остаются на русском языке.",
    en: "The PDF certificate and the request sent to the dean’s office remain in Russian.",
  },
  pickup: { ru: "Получение в деканате", en: "Collection at the dean’s office" },
  pickupHelp: {
    ru: "Выберите удобное время. Приём по талону, один слот — 10 минут. Всё время указано по Москве.",
    en: "Choose a convenient time. Bring your ticket; each appointment lasts 10 minutes. All times are Moscow time.",
  },
  pickupCalled: { ru: "Вас вызывают в {window}", en: "Please go to {window}" },
  pickupBooked: {
    ru: "Подойдите к окну ко времени записи. Отменить или перенести её можно до начала слота.",
    en: "Arrive at the window at your appointment time. You can cancel or reschedule before the appointment starts.",
  },
  reschedule: { ru: "Перенести запись", en: "Reschedule" },
  cancel: { ru: "Отменить запись", en: "Cancel appointment" },
  cancelled: {
    ru: "Запись отменена. Можно выбрать другое время.",
    en: "Appointment cancelled. You can choose another time.",
  },
  moved: {
    ru: "Запись перенесена. Новый талон сохранён.",
    en: "Appointment rescheduled. Your new ticket is saved.",
  },
  booked: {
    ru: "Запись сохранена. Ваш талон готов.",
    en: "Appointment saved. Your ticket is ready.",
  },
  window: { ru: "Окно выдачи", en: "Collection window" },
  date: { ru: "Дата получения", en: "Collection date" },
  time: { ru: "Время получения (МСК)", en: "Collection time (MSK)" },
  msk: { ru: "МСК", en: "MSK" },
  saving: { ru: "Сохраняем…", en: "Saving…" },
  confirmMove: { ru: "Подтвердить перенос", en: "Confirm reschedule" },
  book: { ru: "Записаться на получение", en: "Book collection" },
  keep: { ru: "Оставить прежнюю запись", en: "Keep current appointment" },
  noSlots: {
    ru: "На ближайшие рабочие дни свободных слотов пока нет. Повторите поиск позже или уточните время в деканате.",
    en: "There are no available appointments in the next few working days. Check again later or contact the dean’s office.",
  },
  refresh: { ru: "Обновить слоты", en: "Refresh appointments" },
  savingBooking: { ru: "Сохраняем запись…", en: "Saving appointment…" },
  failed: {
    ru: "Не удалось сохранить запись. Повторите действие.",
    en: "Could not save the appointment. Please try again.",
  },
} as const satisfies Dictionary;
