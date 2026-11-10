import type { Dictionary } from "@/ui/i18n/translate";

export const requestsMessages = {
  title_event_release: {
    ru: "Освобождение от занятий для участия в мероприятии",
    en: "Event attendance exemption",
  },
  title_enrollment: {
    ru: "Справка об обучении",
    en: "Certificate of enrolment",
  },
  title_military: {
    ru: "Справка для военкомата",
    en: "Military office certificate",
  },
  title_visa: { ru: "Справка для визы", en: "Visa certificate" },
  title_scholarship: {
    ru: "Справка о стипендии",
    en: "Scholarship certificate",
  },
  title_retake: { ru: "Заявление на пересдачу", en: "Resit request" },
  title_academic_leave: {
    ru: "Заявление на академотпуск",
    en: "Academic leave request",
  },
  title_enrollment_paper: {
    ru: "Бумажная справка об обучении с печатью",
    en: "Stamped paper certificate of enrolment",
  },
  title_question: {
    ru: "Вопрос в деканат",
    en: "Question for the dean’s office",
  },
  description_event_release: {
    ru: "Хакатон, олимпиада или конференция: согласуйте уважительную причину",
    en: "Request an excused absence for a hackathon, competition or conference",
  },
  description_enrollment: {
    ru: "По месту требования",
    en: "Proof of enrolment for the recipient of your choice",
  },
  description_military: {
    ru: "Подтверждение обучения для военкомата",
    en: "Proof of enrolment for a military registration office",
  },
  description_visa: {
    ru: "Подтверждение обучения для визового обращения",
    en: "Proof of enrolment for a visa application",
  },
  description_scholarship: {
    ru: "Сведения о назначенной стипендии",
    en: "Details of your awarded scholarship",
  },
  description_retake: {
    ru: "Согласование повторной аттестации",
    en: "Request approval to resit an assessment",
  },
  description_academic_leave: {
    ru: "Рассмотрение перерыва в обучении",
    en: "Request a temporary break from your studies",
  },
  description_enrollment_paper: {
    ru: "Оригинал справки с печатью для получения в деканате",
    en: "Collect an original stamped certificate from the dean’s office",
  },
  description_question: {
    ru: "Поможем разобраться с учебным вопросом",
    en: "Get help with a question about your studies",
  },
  field_eventName: { ru: "Название мероприятия", en: "Event name" },
  field_organizer: { ru: "Организатор", en: "Organiser" },
  field_dateFrom: { ru: "Дата с", en: "From date" },
  field_dateTo: { ru: "Дата по", en: "To date" },
  field_eventFormat: { ru: "Формат участия", en: "Participation format" },
  field_confirmation: {
    ru: "Подтверждение: ссылка или текст приглашения",
    en: "Confirmation: link or invitation text",
  },
  field_destination: { ru: "Место требования", en: "Recipient" },
  field_office: { ru: "Военкомат", en: "Military registration office" },
  field_country: { ru: "Страна", en: "Country" },
  field_course: { ru: "Дисциплина", en: "Course" },
  field_reason: { ru: "Причина", en: "Reason" },
  field_period: { ru: "Желаемый период", en: "Requested period" },
  field_question: { ru: "Ваш вопрос", en: "Your question" },
  pdf: { ru: "Электронная справка PDF", en: "Digital PDF certificate" },
  pickup: {
    ru: "Получение в деканате",
    en: "Collection from the dean’s office",
  },
  pickupExpired: {
    ru: "Запись прошла — запишитесь снова",
    en: "Your appointment has passed — book again",
  },
  pickupBookAgain: { ru: "Записаться снова", en: "Book again" },
  workDays_one: { ru: "{count} рабочий день", en: "{count} working day" },
  workDays_few: { ru: "{count} рабочих дня", en: "{count} working days" },
  workDays_other: { ru: "{count} рабочих дней", en: "{count} working days" },
  step: { ru: "Шаг {step} из 2", en: "Step {step} of 2" },
  reviewRequest: { ru: "Проверьте заявку", en: "Review your request" },
  confirmNotice: {
    ru: "Заявка отправится только после вашего подтверждения.",
    en: "Your request will only be sent after you confirm it.",
  },
  draftNotice: {
    ru: "Можно сохранить черновик и вернуться к нему позже.",
    en: "You can save a draft and return to it later.",
  },
  profileData: { ru: "Данные из профиля", en: "Profile details" },
  profileAutomatic: {
    ru: "Данные из профиля · заполняются автоматически",
    en: "Profile details · filled in automatically",
  },
  afterSubmission: { ru: "после отправки", en: "after submission" },
  eventDateRules: {
    ru: "Период — не больше 14 дней. Дата «с» — не раньше чем 14 дней назад, дата «по» — не позже чем через 60 дней. Даты считаются по Москве; годы — от 2000 до 2100.",
    en: "The period must be no longer than 14 days. The start date can be up to 14 days ago and the end date up to 60 days ahead. Dates use Moscow time; years must be between 2000 and 2100.",
  },
  savedDraft: {
    ru: "Черновик сохранён. Он доступен в разделе «Заявки».",
    en: "Draft saved. You can find it under Requests.",
  },
  openDraft: { ru: "Открыть сохранённый черновик", en: "Open saved draft" },
  unsavedChanges: {
    ru: "Есть несохранённые изменения. Сохраните черновик или проверьте заявку перед отправкой.",
    en: "You have unsaved changes. Save a draft or check your request before submitting it.",
  },
  notSpecified: { ru: "Не указано", en: "Not provided" },
  sending: { ru: "Отправляем…", en: "Sending…" },
  confirmSubmission: { ru: "Подтвердить отправку", en: "Confirm submission" },
  editDetails: { ru: "Изменить данные", en: "Edit details" },
  required: { ru: " (обязательно)", en: " (required)" },
  optional: { ru: " (необязательно)", en: " (optional)" },
  saving: { ru: "Сохраняем…", en: "Saving…" },
  checkRequest: { ru: "Проверить заявку", en: "Check request" },
  saveDraft: { ru: "Сохранить черновик", en: "Save draft" },
  deleteDraft: { ru: "Удалить черновик", en: "Delete draft" },
  russianSubmission: {
    ru: "Заявка поступит сотруднику на русском языке. Введённые вами данные сохранятся без перевода.",
    en: "The request is presented to staff in Russian. The details you enter are kept in their original language.",
  },
  fullName: { ru: "ФИО", en: "Full name" },
  faculty: { ru: "Факультет", en: "Faculty" },
  program: { ru: "Направление", en: "Degree programme" },
  courseAndGroup: { ru: "Курс и группа", en: "Year and group" },
  yearAndGroupValue: {
    ru: "{year} курс · {group}",
    en: "Year {year} · {group}",
  },
  recordBookNo: { ru: "Номер зачётки", en: "Student record number" },
  eventLessons: {
    ru: "Пары на время мероприятия",
    en: "Classes during the event",
  },
  eventPast: { ru: "Период в прошлом", en: "This period is in the past" },
  eventChanged: {
    ru: "Расписание изменилось после подачи",
    en: "The timetable has changed since submission",
  },
  currentLessons: {
    ru: "Актуальный список пар и текущие отметки",
    en: "Current classes and attendance records",
  },
  moscow: { ru: "МСК", en: "MSK" },
  attendanceNow: { ru: "Статус сейчас:", en: "Current status:" },
  present: { ru: "Присутствует", en: "Present" },
  excused: { ru: "Уважительная причина", en: "Excused absence" },
  absent: { ru: "Отсутствие", en: "Absent" },
  unmarked: { ru: "Нет отметки", en: "Not marked" },
  noEventLessons: {
    ru: "В эти дни у вас нет пар",
    en: "You have no classes on these dates",
  },
  eventApproval: {
    ru: "При одобрении деканат отметит пары по актуальному расписанию.",
    en: "If approved, the dean’s office will mark the classes in your current timetable as excused.",
  },
  why: { ru: "Почему?", en: "Why?" },
  russianRegulation: {
    ru: "Положение доступно на русском языке.",
    en: "The regulation is available in Russian.",
  },
  error_INTERNAL_ERROR: {
    ru: "Не удалось выполнить действие. Попробуйте снова.",
    en: "The action could not be completed. Please try again.",
  },
  error_VALIDATION: {
    ru: "Проверьте заполненные поля.",
    en: "Please check the completed fields.",
  },
  error_CONFLICT: {
    ru: "Данные изменились. Обновите страницу и попробуйте снова.",
    en: "The details have changed. Refresh the page and try again.",
  },
  error_RATE_LIMITED: {
    ru: "Слишком много запросов. Попробуйте позже.",
    en: "Too many requests. Please try again later.",
  },
  error_FORBIDDEN: {
    ru: "Недостаточно прав для этого действия.",
    en: "You do not have permission to perform this action.",
  },
  error_NOT_FOUND: {
    ru: "Объект не найден.",
    en: "This item could not be found.",
  },
  invalidField: { ru: "Проверьте значение.", en: "Please check this value." },
  formStageProgress: {
    ru: "этап {current} из {total}",
    en: "Stage {current} of {total}",
  },
  requestRequired: {
    ru: "Заполните это поле.",
    en: "Please complete this field.",
  },
  requestTooLong: {
    ru: "Не больше {maxLength} символов.",
    en: "Use no more than {maxLength} characters.",
  },
  requestInvalidValue: {
    ru: "Проверьте значение.",
    en: "Please check this value.",
  },
  requestEventNameControl: {
    ru: "Уберите управляющие символы из названия мероприятия.",
    en: "Remove control characters from the event name.",
  },
  requestEventNameRequired: {
    ru: "Укажите название мероприятия.",
    en: "Enter the event name.",
  },
  requestInvalidDate: {
    ru: "Укажите существующую дату с годом.",
    en: "Enter a valid date including the year.",
  },
  requestInvalidDates: {
    ru: "Укажите существующие даты с годом.",
    en: "Enter valid dates including the year.",
  },
  requestDateOrder: {
    ru: "Дата «по» не может быть раньше даты «с».",
    en: "The end date cannot be earlier than the start date.",
  },
  requestEventTooLong: {
    ru: "Не больше {days} дней включительно.",
    en: "Use no more than {days} days, including both dates.",
  },
  requestPeriodUnavailable: {
    ru: "Не удалось проверить допустимый период. Повторите позже.",
    en: "The permitted period could not be checked. Please try again later.",
  },
  requestDateTooEarly: {
    ru: "Дата «с» — не раньше чем {days} дней назад.",
    en: "The start date cannot be more than {days} days ago.",
  },
  requestDateTooLate: {
    ru: "Дата «по» — не позже чем через {days} дней.",
    en: "The end date cannot be more than {days} days ahead.",
  },
  requestFormUnavailable: {
    ru: "Форма временно недоступна. Выберите другой тип заявки.",
    en: "This form is temporarily unavailable. Choose another request type.",
  },
  pickupUnavailable: {
    ru: "Запись временно недоступна. Повторите позже.",
    en: "Appointments are temporarily unavailable. Please try again later.",
  },
  pickupNotEligible: {
    ru: "Записаться можно только за готовой бумажной справкой.",
    en: "You can book collection only for a paper certificate that is ready.",
  },
  pickupInvalidSlot: {
    ru: "Выберите будущий 10-минутный слот в рабочее время окна (МСК).",
    en: "Choose a future 10-minute appointment during the window’s opening hours (Moscow time).",
  },
  requests: { ru: "Заявки", en: "Requests" },
  onlineOffice: { ru: "Деканат онлайн", en: "Dean’s office online" },
  requestsLead: {
    ru: "Справки, заявления и понятный путь до результата.",
    en: "Certificates, applications and a clear path to the result.",
  },
  newRequest: { ru: "Новая заявка", en: "New request" },
  draftUnsent: {
    ru: "Черновик · ещё не отправлен",
    en: "Draft · not yet submitted",
  },
  expectedDateLabel: { ru: "Ожидаемая дата", en: "Expected date" },
  expectedDate: {
    ru: "Ожидаемая дата: {date} (МСК)",
    en: "Expected date: {date} (MSK)",
  },
  deadlineLater: {
    ru: "Срок появится после отправки",
    en: "The expected date will appear after submission",
  },
  continueDraft: { ru: "Продолжить черновик", en: "Continue draft" },
  trackRequest: { ru: "Отследить заявку", en: "Track request" },
  noRequests: { ru: "Заявок пока нет", en: "No requests yet" },
  noRequestsHelp: {
    ru: "Закажите справку или задайте вопрос деканату. Здесь появятся этапы обработки и ожидаемый срок.",
    en: "Order a certificate or ask the dean’s office a question. Processing stages and an expected date will appear here.",
  },
  chooseType: { ru: "Выбрать тип заявки", en: "Choose a request type" },
  allTypes: { ru: "← Все типы заявок", en: "← All request types" },
  myRequests: { ru: "← Мои заявки", en: "← My requests" },
  catalogLead: {
    ru: "Выберите, с чем помочь. Сроки указаны в рабочих днях, с понедельника по пятницу.",
    en: "Choose what you need help with. Processing times are in working days, Monday to Friday.",
  },
  choose: { ru: "Выбрать: {title}", en: "Choose: {title}" },
  catalogEmpty: {
    ru: "Каталог временно пуст",
    en: "The catalogue is temporarily empty",
  },
  catalogEmptyHelp: {
    ru: "Попробуйте обновить страницу позже или обратитесь в деканат.",
    en: "Try refreshing the page later or contact the dean’s office.",
  },
  toRequests: { ru: "К моим заявкам", en: "Go to my requests" },
  request: { ru: "Заявка", en: "Request" },
  happening: { ru: "Что происходит?", en: "What is happening?" },
  certificateRevoked: {
    ru: "Справка отозвана. Ссылка проверки покажет её актуальный статус.",
    en: "The certificate has been revoked. The verification link shows its current status.",
  },
  certificateIssued: {
    ru: "Справка выдана. История получения останется в вашем кабинете.",
    en: "Your certificate has been collected. The collection history will remain in your account.",
  },
  certificatePickupReady: {
    ru: "Справка готова. Запишитесь на получение оригинала с печатью в деканате.",
    en: "Your certificate is ready. Book an appointment to collect the stamped original from the dean’s office.",
  },
  certificatePdfReady: {
    ru: "Документ готов. Скачайте PDF — получатель проверит его по QR-коду.",
    en: "Your document is ready. Download the PDF; the recipient can verify it using the QR code.",
  },
  dateWithZone: { ru: "{date} (МСК)", en: "{date} (MSK)" },
  beingConfirmed: { ru: "Уточняется", en: "To be confirmed" },
  delivery: { ru: "Получение", en: "Delivery" },
  assignee: { ru: "Ответственный", en: "Assigned to" },
  unassigned: {
    ru: "Деканат · сотрудник ещё не назначен",
    en: "Dean’s office · no staff member assigned yet",
  },
  requestDetails: { ru: "Данные заявки", en: "Request details" },
  progress: { ru: "Путь заявки", en: "Request progress" },
  stageTimes: {
    ru: "Время этапов — московское.",
    en: "Stage times are shown in Moscow time.",
  },
  slaDeadline: {
    ru: "Срок по SLA — до {date} (МСК)",
    en: "Service deadline: {date} (MSK)",
  },
  currentStage: { ru: " · текущий этап", en: " · current stage" },
  awaited: { ru: "{status} · ожидается", en: "{status} · pending" },
  historyLater: {
    ru: "История появится после отправки заявки.",
    en: "The history will appear after you submit the request.",
  },
  stageProgress: {
    ru: "этап {current} из {total}",
    en: "stage {current} of {total}",
  },
  draft: { ru: "Черновик", en: "Draft" },
  submitted: { ru: "Подана", en: "Submitted" },
  accepted: { ru: "Принята", en: "Accepted" },
  in_progress: { ru: "В работе", en: "In progress" },
  needs_info: { ru: "Нужна информация", en: "More information needed" },
  ready: { ru: "Готова", en: "Ready" },
  issued: { ru: "Выдана", en: "Issued" },
  rejected: { ru: "Отклонена", en: "Rejected" },
  cancelled: { ru: "Отменена", en: "Cancelled" },
  sla_overdue: { ru: "Просрочено", en: "Overdue" },
  sla_soon: {
    ru: "Скоро · не больше 1 рабочего дня",
    en: "Due soon · within 1 working day",
  },
  sla_on_time: { ru: "В срок", en: "On time" },
  actions: { ru: "Действия по заявке", en: "Request actions" },
  replyHeading: { ru: "Ответьте деканату", en: "Reply to the dean’s office" },
  replyRequired: {
    ru: "Уточнение к заявке (обязательно)",
    en: "Additional information (required)",
  },
  sendReply: { ru: "Отправить ответ", en: "Send reply" },
  cancelQuestion: {
    ru: "Отменить заявку? Для нового обращения понадобится подать новую.",
    en: "Cancel this request? You will need to submit a new request for any further enquiry.",
  },
  confirmCancellation: { ru: "Подтвердить отмену", en: "Confirm cancellation" },
  keepWaiting: { ru: "Продолжить ожидание", en: "Keep waiting" },
  cancelRequest: { ru: "Отменить заявку", en: "Cancel request" },
  explanationDraft: {
    ru: "Заявка сохранена у вас. Деканат получит её после подтверждения отправки.",
    en: "Your request is saved in your account. The dean’s office will receive it after you confirm submission.",
  },
  explanationSubmitted: {
    ru: "Заявка поступила в деканат. Сотрудник проверит данные и примет её в работу. Пока заявку можно отменить.",
    en: "The dean’s office has received your request. A staff member will check the details and accept it for processing. You can still cancel it.",
  },
  explanationAccepted: {
    ru: "Данные проверены. Сотрудник скоро начнёт готовить ответ или справку.",
    en: "Your details have been checked. A staff member will start preparing a response or certificate soon.",
  },
  explanationInProgress: {
    ru: "Сотрудник готовит результат. Дополнительных действий от вас сейчас не требуется.",
    en: "A staff member is preparing the result. You do not need to do anything else at the moment.",
  },
  explanationNeedsInfo: {
    ru: "Для продолжения нужны уточнения. Прочитайте комментарий сотрудника и отправьте ответ ниже.",
    en: "More information is needed to continue. Read the staff member’s comment and send a reply below.",
  },
  explanationReady: {
    ru: "Результат готов. Электронная справка доступна в кабинете, бумажный документ — в деканате.",
    en: "The result is ready. A digital certificate is available in your account; a paper document can be collected from the dean’s office.",
  },
  explanationIssued: {
    ru: "Результат выдан. История обращения останется в вашем кабинете.",
    en: "The result has been issued. The request history will remain in your account.",
  },
  explanationRejected: {
    ru: "Деканат объяснил причину в комментарии. При необходимости подайте новую заявку с уточнёнными данными.",
    en: "The dean’s office has explained the reason in a comment. If needed, submit a new request with updated details.",
  },
  explanationCancelled: {
    ru: "Вы отменили заявку до начала обработки. При необходимости создайте новую.",
    en: "You cancelled the request before processing began. Create a new request if needed.",
  },
  explanationEventAccepted: {
    ru: "Данные проверены. Сотрудник скоро рассмотрит освобождение на время мероприятия.",
    en: "Your details have been checked. A staff member will review your event attendance exemption soon.",
  },
  explanationEventInProgress: {
    ru: "Сотрудник рассматривает освобождение и проверяет пары на время мероприятия. Дополнительных действий от вас сейчас не требуется.",
    en: "A staff member is reviewing your exemption and checking classes during the event. You do not need to do anything else at the moment.",
  },
  explanationEventReady: {
    ru: "Освобождение одобрено. Пары на время мероприятия отмечены как уважительные.",
    en: "Your exemption has been approved. Classes during the event have been marked as excused absences.",
  },
  explanationEventIssued: {
    ru: "Заявка завершена. Пары на время мероприятия отмечены как уважительные. История обращения останется в вашем кабинете.",
    en: "Your request is complete. Classes during the event have been marked as excused absences. The request history will remain in your account.",
  },
  explanationAppealAccepted: {
    ru: "Данные проверены. Сотрудник скоро рассмотрит заявку.",
    en: "Your details have been checked. A staff member will review your request soon.",
  },
  explanationAppealInProgress: {
    ru: "Сотрудник рассматривает заявку. Решение или ответ появится в его комментарии.",
    en: "A staff member is reviewing your request. Their decision or response will appear in a comment.",
  },
  explanationAppealReady: {
    ru: "Рассмотрение завершено. Решение или ответ — в комментарии сотрудника.",
    en: "The review is complete. Read the staff member’s comment for the decision or response.",
  },
  explanationAppealIssued: {
    ru: "Заявка завершена. Решение или ответ — в комментарии сотрудника. История обращения останется в вашем кабинете.",
    en: "Your request is complete. Read the staff member’s comment for the decision or response. The request history will remain in your account.",
  },
} as const satisfies Dictionary;
