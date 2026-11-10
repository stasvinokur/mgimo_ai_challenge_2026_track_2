import type { Dictionary } from "@/ui/i18n/translate";

export const gradesMessages = {
  whatIf: {
    ru: "Что если?",
    en: "What if?",
  },
  whatIfHint: {
    ru: "Попробуйте разные баллы. Это расчёт для вас, он не сохраняется.",
    en: "Try different scores. This calculation is for you and is not saved.",
  },
  submit: {
    ru: "Сдать",
    en: "Submit",
  },
  skip: {
    ru: "Пропустить",
    en: "Skip",
  },
  predictedScore: {
    ru: "Предполагаемый балл при сдаче: {score} из {max}",
    en: "Expected score if submitted: {score} out of {max}",
  },
  scoreOutOf: {
    ru: "{score} из {max}",
    en: "{score} out of {max}",
  },
  sliderHint: {
    ru: "Стрелки меняют балл на 1, Home — 0, End — максимум.",
    en: "Arrow keys change the score by 1; Home sets 0 and End sets the maximum.",
  },
  workUnreachable: {
    ru: "При выбранных баллах за другие работы цель ≥ {target} недостижима за эту работу.",
    en: "With the selected scores for other work, this assignment cannot bring the total to ≥ {target}.",
  },
  workMinimum: {
    ru: "Нужно ≥ {minimum} из {max}, чтобы итог был ≥ {target}.",
    en: "You need ≥ {minimum} out of {max} for a total of ≥ {target}.",
  },
  requiredWorkHint: {
    ru: "Работа обязательная: пропуск оставит её несданной, даже если баллов достаточно.",
    en: "This assignment is required: skipping it leaves it outstanding even if you have enough points.",
  },
  projectedTotal: {
    ru: "Прогноз итога: {score} из 100 — {grade}",
    en: "Projected total: {score} out of 100 — {grade}",
  },
  credit: {
    ru: "зачёт",
    en: "pass",
  },
  noCreditYet: {
    ru: "пока нет зачёта",
    en: "not yet a pass",
  },
  targetReached: {
    ru: "достигнута в расчёте",
    en: "reached in this calculation",
  },
  targetNotReached: {
    ru: "пока не достигнута",
    en: "not yet reached",
  },
  forecastCredit: {
    ru: "По баллам: {credit}. Цель ≥ {target}: {result}.",
    en: "Based on points: {credit}. Target ≥ {target}: {result}.",
  },
  targetUnreachable: {
    ru: "Цель недостижима даже при максимуме за все оставшиеся работы. Обсудите с преподавателем возможность улучшить результат.",
    en: "The target cannot be reached even with the maximum score for all remaining assignments. Discuss ways to improve your result with your teacher.",
  },
  scenarioScholarship: {
    ru: "Стипендия в этом сценарии",
    en: "Scholarship in this scenario",
  },
  forkSubmit: {
    ru: "Сдать на {score} из {max}",
    en: "Submit with {score} out of {max}",
  },
  forkCurrent: {
    ru: "Сейчас: {score} из 100",
    en: "Current: {score} out of 100",
  },
  selected: {
    ru: "Выбрано",
    en: "Selected",
  },
  forkTotal: {
    ru: "Итог {score} из 100",
    en: "Total {score} out of 100",
  },
  forkTarget: {
    ru: "Цель ≥ {target}: {result}",
    en: "Target ≥ {target}: {result}",
  },
  scholarship: {
    ru: "Стипендия",
    en: "Scholarship",
  },
  academicScholarship: {
    ru: "Академическая стипендия",
    en: "Academic scholarship",
  },
  increasedScholarship: {
    ru: "Повышенная стипендия",
    en: "Increased scholarship",
  },
  scholarshipStateRetained: {
    ru: "Сохраняется",
    en: "Retained",
  },
  scholarshipStateAtRisk: {
    ru: "Под угрозой",
    en: "At risk",
  },
  scholarshipStateUnreachable: {
    ru: "Недостижима в этом семестре",
    en: "Unreachable this semester",
  },
  scholarshipStateDebt: {
    ru: "Нужно закрыть долг",
    en: "Outstanding work to complete",
  },
  scholarshipStateClarification: {
    ru: "Требует уточнения",
    en: "Needs clarification",
  },
  scholarshipStateEligible: {
    ru: "Достижима",
    en: "Within reach",
  },
  scholarshipNone: {
    ru: "Пока без стипендии",
    en: "No scholarship yet",
  },
  scholarshipAtRisk: {
    ru: "{title} под угрозой",
    en: "{title} is at risk",
  },
  scholarshipDebt: {
    ru: "{current}: есть долг по дисциплине «{course}».",
    en: "{current}: there is an outstanding requirement in «{course}».",
  },
  scholarshipClarification: {
    ru: "Прогноз стипендии требует уточнения.",
    en: "The scholarship forecast needs clarification.",
  },
  scholarshipRequirement: {
    ru: "нужно не меньше {minimum} из {max} за «{title}» по дисциплине «{course}»",
    en: "you need at least {minimum} out of {max} for «{title}» in «{course}»",
  },
  scholarshipMoreRequirements: {
    ru: "; остальные условия — ниже",
    en: "; see the other conditions below",
  },
  scholarshipCheckWork: {
    ru: "проверьте оставшиеся работы",
    en: "check your remaining assignments",
  },
  scholarshipIncreasedEligible: {
    ru: "Повышенная достижима по итогам семестра.",
    en: "An increased scholarship is within reach at the end of the semester.",
  },
  scholarshipIncreasedRequirement: {
    ru: "Для повышенной {hint}.",
    en: "For an increased scholarship, {hint}.",
  },
  scholarshipIncreasedUnreachable: {
    ru: "Повышенная недостижима в этом семестре.",
    en: "An increased scholarship is unreachable this semester.",
  },
  scholarshipRetained: {
    ru: "{title} сохраняется.",
    en: "{title} is retained.",
  },
  scholarshipAcademicEligible: {
    ru: "Академическая достижима.",
    en: "An academic scholarship is within reach.",
  },
  scholarshipUnreachable: {
    ru: "{title} недостижима в этом семестре.",
    en: "{title} is unreachable this semester.",
  },
  scholarshipNoneAtRisk: {
    ru: "Пока без стипендии: для академической {hint}.",
    en: "No scholarship yet: for an academic scholarship, {hint}.",
  },
  scholarshipCurrentAtRisk: {
    ru: "{title} под угрозой: {hint}.",
    en: "{title} is at risk: {hint}.",
  },
  scholarshipDebtHelp: {
    ru: "Согласуйте с преподавателем сдачу долга, затем проверьте прогноз.",
    en: "Agree with your teacher how to complete the outstanding work, then check the forecast.",
  },
  scholarshipClarificationHelp: {
    ru: "Уточните данные у преподавателя или в деканате.",
    en: "Check the details with your teacher or the dean’s office.",
  },
  scholarshipUnreachableHelp: {
    ru: "Обсудите с преподавателем возможность улучшить результат.",
    en: "Discuss ways to improve your result with your teacher.",
  },
  scholarshipBlockerDebt: {
    ru: "Долг по обязательной работе",
    en: "Outstanding required assignment",
  },
  scholarshipBlockerClarification: {
    ru: "Данные по дисциплине требуют уточнения",
    en: "Course data needs clarification",
  },
  scholarshipBlockerThreshold: {
    ru: "Итог ниже {threshold} — {grade}",
    en: "Total below {threshold} — {grade}",
  },
  scholarshipMaximumInsufficient: {
    ru: "Даже максимума за оставшиеся работы недостаточно для итога ≥ {threshold}.",
    en: "Even the maximum score for remaining work is not enough for a total of ≥ {threshold}.",
  },
  scholarshipWorkMinimum: {
    ru: "«{title}»: не меньше {minimum} из {max}.",
    en: "«{title}»: at least {minimum} out of {max}.",
  },
  openCourse: {
    ru: "Открыть дисциплину",
    en: "Open course",
  },
  scholarshipAllRequired: {
    ru: "Нужно сдать все перечисленные работы на указанные баллы.",
    en: "You need to submit all the listed assignments with the indicated scores.",
  },
  scholarshipCalculationLabel: {
    ru: "Как считается стипендия",
    en: "How the scholarship is calculated",
  },
  howCalculated: {
    ru: "Как считается?",
    en: "How is it calculated?",
  },
  scholarshipCalculation: {
    ru: "Оставшиеся работы без выбранного балла считаются как 0. Для академической стипендии нужны все итоги ≥ 70, для повышенной — ≥ 86, без долгов. Это ориентир: назначение выплаты — после сессии.",
    en: "Remaining assignments with no selected score count as 0. An academic scholarship requires all totals ≥ 70; an increased scholarship requires ≥ 86, with no outstanding work. This is a guide: scholarships are awarded after the exam session.",
  },
  why: {
    ru: "Почему?",
    en: "Why?",
  },
  scholarshipRules: {
    ru: " Правила стипендии",
    en: " Scholarship rules",
  },
  gradingAverage: {
    ru: "Средний текущий балл — среднее по оценённым работам каждой дисциплины. Дисциплины, данные которых уточняются, в среднее не входят.",
    en: "The current average is based on graded assignments in each course. Courses whose data needs clarification are excluded.",
  },
  gradingTotal: {
    ru: "Итог без новых баллов считает оставшиеся работы как 0. Итог = сумма (балл / максимум × вес), сумма весов — 100 %. Обязательные работы нужно сдать независимо от баллов.",
    en: "The total without new points counts remaining assignments as 0. Total = sum of (score / maximum × weight); weights add up to 100%. Required assignments must be submitted regardless of points.",
  },
  gradingRules: {
    ru: "Вымышленные правила: от 86 — «отлично», от 70 — «хорошо», от 55 — «удовлетворительно» и зачёт. Ниже 55 — «неудовлетворительно». Время указано по Москве.",
    en: "Fictional rules: 86 or more is «excellent», 70 or more is «good», 55 or more is «satisfactory» and a pass. Below 55 is «unsatisfactory». Times are shown in Moscow time.",
  },
  currentSemester: { ru: "Текущий семестр", en: "Current semester" },
  study: { ru: "Учёба", en: "Study" },
  studyLead: {
    ru: "Ваша успеваемость, ближайшие шаги и пространство для «Что если?».",
    en: "Your progress, next steps and space to explore “What if?”.",
  },
  noGrades: { ru: "Оценок пока нет", en: "No scores yet" },
  noGradesHint: {
    ru: "Работы появятся, когда их добавят для вашей группы. Пока можно посмотреть расписание.",
    en: "Assessments will appear when they are added for your group. You can check your timetable in the meantime.",
  },
  openSchedule: { ru: "Открыть расписание", en: "Open timetable" },
  progress: { ru: "Как у меня дела", en: "How am I doing" },
  debtsSummary: {
    ru: "Есть долг по {courses}: согласуйте с преподавателем срок сдачи обязательной работы.",
    en: "Outstanding work in {courses}: agree a deadline with your teacher for the required assessment.",
  },
  averageScore: { ru: "Средний текущий балл", en: "Average current score" },
  goodCourses: { ru: "Дисциплин в норме", en: "Courses on track" },
  attention: { ru: "Требуют внимания", en: "Need attention" },
  openDebts: { ru: "Открытых долгов", en: "Outstanding requirements" },
  courseTarget: {
    ru: "Ваша цель: ≥ {target} по каждой дисциплине.",
    en: "Your target: ≥ {target} in every course.",
  },
  finishRequired: {
    ru: "Сначала закройте обязательные работы, затем проверьте прогресс к цели.",
    en: "Complete required assessments first, then check your progress towards the target.",
  },
  averagePending: {
    ru: "Средний балл появится после первой оценки.",
    en: "Your average will appear after the first score.",
  },
  averageReaches: {
    ru: "Средний текущий балл достигает вашей цели.",
    en: "Your average current score reaches your target.",
  },
  averageBelow: {
    ru: "Средний текущий балл пока ниже вашей цели.",
    en: "Your average current score is still below your target.",
  },
  currentScore: { ru: "Текущий балл", en: "Current score" },
  securedScore: { ru: "Итог без новых баллов", en: "Total without new scores" },
  indicatorCourse: {
    ru: " Индикатор дисциплины «{course}»",
    en: " Course indicator for “{course}”",
  },
  overdue: { ru: "Просрочено", en: "Overdue" },
  nextDeadline: { ru: "Ближайший срок", en: "Next deadline" },
  moscow: { ru: "МСК", en: "MSK" },
  details: { ru: "Подробнее", en: "Details" },
  aboutCourse: { ru: " о дисциплине «{course}»", en: " for “{course}”" },
  securedGrade: {
    ru: "Итог без новых баллов: {grade}. Ваша цель: ≥ {target}.",
    en: "Total without new scores: {grade}. Your target: ≥ {target}.",
  },
  worksDeadlines: { ru: "Работы и сроки", en: "Works and deadlines" },
  submittedScore: {
    ru: "Сдано: {score} из {max}",
    en: "Submitted: {score} out of {max}",
  },
  overdueWork: {
    ru: "Просрочено — согласуйте срок сдачи",
    en: "Overdue — agree a submission deadline",
  },
  upcomingWork: { ru: "Предстоит сдать", en: "To be submitted" },
  weight: { ru: "Вес {weight} %", en: "Weight {weight}%" },
  required: { ru: "Обязательная", en: "Required" },
  optional: { ru: "Необязательная", en: "Optional" },
  due: { ru: "до", en: "due" },
  exams: { ru: "Сессия", en: "Exams and credits" },
  noExamDates: {
    ru: "Даты ещё не назначены. Проверьте раздел позже.",
    en: "Dates have not been set yet. Check back later.",
  },
  exam: { ru: "Экзамен", en: "Exam" },
  creditAssessment: { ru: "Зачёт", en: "Pass/fail assessment" },
  creditByScore: {
    ru: " · по баллам: {credit}",
    en: " · based on scores: {credit}",
  },
  creditPass: { ru: "зачёт", en: "pass" },
  creditPending: { ru: "пока нет зачёта", en: "not yet a pass" },
  allCourses: { ru: "Все дисциплины", en: "All courses" },
  coursePageTitle: { ru: "Успеваемость по дисциплине", en: "Course progress" },
  loadingGrades: {
    ru: "Загружаем успеваемость…",
    en: "Loading your progress…",
  },
  loadError: {
    ru: "Не удалось загрузить страницу",
    en: "Could not load this page",
  },
  loadErrorHint: {
    ru: "Иногда соединению нужна ещё одна попытка. Попробуйте загрузить страницу снова.",
    en: "The connection may need another try. Please reload this page.",
  },
  retry: { ru: "Повторить", en: "Try again" },
  light_debt: { ru: "Есть долг", en: "Outstanding work" },
  light_plan: { ru: "Нужен план действий", en: "An action plan is needed" },
  light_good: { ru: "В норме", en: "On track" },
  light_borderline: { ru: "На грани", en: "At risk" },
  "light_target-unreachable": { ru: "На грани", en: "At risk" },
  light_clarification: {
    ru: "Данные по дисциплине уточняются",
    en: "Course data is being checked",
  },
  lightReason_debt: {
    ru: "Просрочена обязательная работа. Баллов недостаточно для закрытия долга без её сдачи.",
    en: "A required assessment is overdue. Scores alone cannot clear it without submission.",
  },
  lightReason_plan: {
    ru: "Даже максимум за оставшиеся работы не даст 55 баллов.",
    en: "Even full marks in the remaining assessments will not reach 55 points.",
  },
  lightReason_good: {
    ru: "Уже набранных баллов достаточно для вашей цели.",
    en: "Your existing scores are enough to reach your target.",
  },
  lightReason_borderline: {
    ru: "Без новых баллов итог ниже вашей цели, но её ещё можно достичь.",
    en: "Without new scores your total is below your target, but you can still reach it.",
  },
  "lightReason_target-unreachable": {
    ru: "Цель недостижима за оставшиеся работы, но набрать 55 баллов ещё возможно.",
    en: "The remaining assessments cannot bring you to your target, but 55 points is still possible.",
  },
  lightReason_clarification: {
    ru: "Для расчёта пока недостаточно проверенных данных.",
    en: "There is not enough verified data for a calculation yet.",
  },
  lightAction_debt: {
    ru: "Свяжитесь с преподавателем и согласуйте срок сдачи обязательной работы.",
    en: "Contact your teacher to agree a deadline for the required assessment.",
  },
  lightAction_plan: {
    ru: "Обсудите с преподавателем возможность пересдачи.",
    en: "Discuss the possibility of a retake with your teacher.",
  },
  lightAction_goodPending: {
    ru: "Проверьте сроки оставшихся обязательных работ: цель по баллам не отменяет их сдачу.",
    en: "Check the deadlines for remaining required assessments: reaching your score target does not remove the need to submit them.",
  },
  lightAction_goodComplete: {
    ru: "Все работы оценены. Проверьте даты сессии.",
    en: "All assessments have been graded. Check your exam dates.",
  },
  lightAction_borderline: {
    ru: "Рассчитайте нужные баллы и запланируйте сдачу оставшихся работ.",
    en: "Calculate the scores you need and plan your remaining submissions.",
  },
  "lightAction_target-unreachable": {
    ru: "Обсудите с преподавателем, как улучшить результат.",
    en: "Discuss how to improve your result with your teacher.",
  },
  lightAction_clarification: {
    ru: "Проверьте раздел позже или уточните данные у преподавателя.",
    en: "Check back later or ask your teacher to clarify the data.",
  },
  courseActions: { ru: "Что можно сделать?", en: "What can I do?" },
  forCourse: { ru: " по дисциплине «{course}»", en: " for “{course}”" },
  action_overdue: {
    ru: "Согласовать сдачу работы «{work}»",
    en: "Arrange submission of “{work}”",
  },
  action_submit: { ru: "Сдать работу «{work}»", en: "Submit “{work}”" },
  action_review: {
    ru: "Уточнить возможность улучшить результат",
    en: "Ask about ways to improve your result",
  },
  actionDescription_overdue: {
    ru: "Срок {date} МСК уже прошёл. Уточните возможность сдачи и согласуйте новую дату с преподавателем.",
    en: "The deadline of {date} MSK has passed. Ask your teacher whether you can still submit and agree a new date.",
  },
  actionDescription_submit: {
    ru: "Можно запланировать сдачу до {date} МСК.",
    en: "You can plan to submit by {date} MSK.",
  },
  actionDescription_review: {
    ru: "Все работы оценены. Можно обсудить с преподавателем доступные варианты и сроки.",
    en: "All assessments have been graded. Discuss available options and deadlines with your teacher.",
  },
  actionEffect: {
    ru: "Что это даст: {score} из {max} → итог {total} из 100 ({grade}); без этой работы — {baseline}. Цель ≥ {target} {reached}.",
    en: "Expected result: {score} out of {max} → total {total} out of 100 ({grade}); without this assessment: {baseline}. Target ≥ {target}: {reached}.",
  },
  actionReviewEffect: {
    ru: "Итог без новых баллов — {total} из 100. Расчёт «Что если?» не меняет уже выставленные оценки.",
    en: "Total without new scores: {total} out of 100. The “What if?” calculation does not change existing scores.",
  },
  actionReached: {
    ru: "достигнута в расчёте",
    en: "reached in this calculation",
  },
  actionNotReached: { ru: "пока не достигнута", en: "not yet reached" },
  "note_other-work-zero": {
    ru: "Другие несданные работы учтены как 0 баллов.",
    en: "Other unsubmitted assessments count as 0 points.",
  },
  "note_required-confirmation": {
    ru: "Сдачу обязательной работы подтверждает преподаватель.",
    en: "Your teacher confirms submission of a required assessment.",
  },
  appealTitle: { ru: "Не успеваете?", en: "Need more time?" },
  appealDescription: {
    ru: "Можно уточнить в деканате, как согласовать дальнейшие шаги. Текст обращения можно изменить перед отправкой.",
    en: "Ask the dean’s office how to agree your next steps. You can edit the enquiry before sending.",
  },
  prepareAppeal: { ru: "Подготовить обращение", en: "Prepare an enquiry" },
  discussAssistant: {
    ru: "Обсудить с ассистентом",
    en: "Discuss with the assistant",
  },
  assistantQuestion: {
    ru: "Что можно сделать по дисциплине «{course}»?\nДисциплина: «{course}».\n{facts}\nПомоги составить план действий и объясни варианты.",
    en: "What can I do for the course «{course}»?\nCourse: «{course}».\n{facts}\nHelp me make an action plan and explain the options.",
  },
  assistantWorkFacts: {
    ru: "Работа: «{work}». Срок: {date} МСК.{overdue}",
    en: "Assignment: «{work}». Deadline: {date} MSK.{overdue}",
  },
  assistantOverdue: {
    ru: " Срок уже прошёл.",
    en: " The deadline has passed.",
  },
  assistantAllGraded: {
    ru: "Все работы по дисциплине оценены; несданных работ нет.",
    en: "All assignments in this course have been graded; no work is outstanding.",
  },
  assistantScoreFacts: {
    ru: "Текущий итог без новых баллов: {total} из 100. Моя цель: ≥ {target}.",
    en: "Current total without new scores: {total} out of 100. My target: ≥ {target}.",
  },
  appealRussian: {
    ru: "Текст обращения отправляется в деканат на русском языке. Его можно изменить перед отправкой.",
    en: "The enquiry sent to the dean’s office is in Russian. You can edit it before sending.",
  },
  scoreHistory: { ru: "История изменений", en: "Score history" },
  historyEmpty: {
    ru: "Изменений пока нет. Когда преподаватель выставит или исправит балл, запись появится здесь.",
    en: "No changes yet. A record will appear here when your teacher adds or corrects a score.",
  },
  notGraded: { ru: "Не выставлен", en: "Not graded" },
  changedTeacher: { ru: "Изменил преподаватель", en: "Changed by a teacher" },
  reason_appeal_review: {
    ru: "Пересмотр после апелляции",
    en: "Review after an appeal",
  },
  reason_entry_error: {
    ru: "Исправление ошибки ввода",
    en: "Correction of an entry error",
  },
  reason_retake: { ru: "Пересдача", en: "Retake" },
  reason_excused: { ru: "Уважительная причина", en: "Valid reason" },
  reason_late_submission: { ru: "Работа сдана позже", en: "Late submission" },
  reason_clarification: {
    ru: "Причина уточняется",
    en: "Reason being clarified",
  },
  excellent: { ru: "отлично", en: "excellent" },
  good: { ru: "хорошо", en: "good" },
  satisfactory: { ru: "удовлетворительно", en: "satisfactory" },
  unsatisfactory: { ru: "неудовлетворительно", en: "unsatisfactory" },
  noScore: { ru: "Пока нет", en: "Not yet" },
} as const satisfies Dictionary;
