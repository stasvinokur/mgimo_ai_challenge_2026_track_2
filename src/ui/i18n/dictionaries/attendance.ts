import type { Dictionary } from "@/ui/i18n/translate";

export const attendanceMessages = {
  attendance: { ru: "Посещаемость", en: "Attendance" },
  pageTitle: { ru: "Отметка на паре", en: "Class check-in" },
  freshQr: {
    ru: "Чтобы отметиться, откройте свежий QR-код с экрана преподавателя.",
    en: "To check in, open the current QR code on your teacher’s screen.",
  },
  myAttendance: { ru: "Моя посещаемость", en: "My attendance" },
  summaryTitle: {
    ru: "Посещаемость и активность",
    en: "Attendance and activity",
  },
  activityTitle: { ru: "Мои баллы активности", en: "My activity points" },
  activityGoal: {
    ru: "из {goal} — личная цель",
    en: "of {goal} — personal goal",
  },
  activityExplanation: {
    ru: "+1 за отметку «был». Баллы не влияют на оценки и стипендию.",
    en: "+1 for checking in as present. These points do not affect grades or your scholarship.",
  },
  why: { ru: "Почему?", en: "Why?" },
  presentTotal: {
    ru: "Был на {present} из {total}",
    en: "Attended {present} of {total}",
  },
  excusedOnly: {
    ru: "Пока отмечены только уважительные причины.",
    en: "Only excused absences have been recorded so far.",
  },
  excused: {
    ru: "Уважительные причины: {count}. Не входят в расчёт процента.",
    en: "Excused absences: {count}. Excluded from the attendance percentage.",
  },
  unmarked: {
    ru: "По остальным дисциплинам отметок пока нет",
    en: "No attendance has been recorded for your other courses yet",
  },
  empty: {
    ru: "Занятий пока нет. Когда появится расписание, здесь будет ваша посещаемость.",
    en: "No classes yet. Your attendance will appear here when your timetable is available.",
  },
  invalidCode: {
    ru: "Код недействителен или устарел",
    en: "This code is invalid or has expired",
  },
  alreadyPresent: { ru: "Вы уже отмечены", en: "You have already checked in" },
  marked: {
    ru: "Отмечено ✓ · +{points} балл активности",
    en: "Checked in ✓ · +{points} activity point",
  },
  confirmTitle: {
    ru: "Отметиться на паре «{course}»?",
    en: "Check in for “{course}”?",
  },
  confirmHint: {
    ru: "Подтвердите, что вы в аудитории. За отметку «был» — 1 балл активности.",
    en: "Confirm that you are in the classroom. Checking in earns 1 activity point.",
  },
  pending: { ru: "Отмечаем…", en: "Checking in…" },
  checkIn: { ru: "Отметиться", en: "Check in" },
  myPoints: { ru: "Моя посещаемость и баллы", en: "My attendance and points" },
  forbidden: {
    ru: "Недостаточно прав для этого действия.",
    en: "You do not have permission to do this.",
  },
  rateLimited: {
    ru: "Слишком много запросов. Попробуйте позже.",
    en: "Too many requests. Please try again later.",
  },
  invalidForm: {
    ru: "Проверьте поля формы.",
    en: "Please check the form and try again.",
  },
  failed: {
    ru: "Не удалось выполнить действие. Попробуйте снова.",
    en: "Could not complete the action. Please try again.",
  },
  errorTitle: {
    ru: "Не удалось загрузить страницу",
    en: "Could not load the page",
  },
  errorHint: {
    ru: "Иногда соединению нужна ещё одна попытка. Попробуйте загрузить страницу снова.",
    en: "The connection may need another attempt. Please try loading the page again.",
  },
  retry: { ru: "Повторить", en: "Try again" },
} as const satisfies Dictionary;
