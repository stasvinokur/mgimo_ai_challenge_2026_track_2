import "server-only";
import { createCertificatesModule } from "./modules/certificates";
import { createGradesModule } from "./modules/grades";
import { createIdentityModule } from "./modules/identity";
import { createNotificationsModule } from "./modules/notifications";
import { createRegulationsModule } from "./modules/regulations";
import { createRequestsModule } from "./modules/requests";
import { createScheduleModule } from "./modules/schedule";
import { createSharedModule } from "./modules/shared";
import { createSpeechModule } from "./modules/speech";
import { createStaffModule } from "./modules/staff";
import { createStudentModule } from "./modules/student";
import { createSystemModule } from "./modules/system";
import { createTeacherModule } from "./modules/teacher";
import { createTodayModule } from "./modules/today";

export const system = createSystemModule();
export const teacher = createTeacherModule(system);
export const certificates = createCertificatesModule(system);
export const shared = createSharedModule();
export const identity = createIdentityModule(system);
export const student = createStudentModule();
export const schedule = createScheduleModule(system);
export const grades = createGradesModule(system);
export const requests = createRequestsModule(system);
export const regulations = createRegulationsModule();
export const notifications = createNotificationsModule(system);
export const staff = createStaffModule(system);
export const today = createTodayModule(
  {
    schedule: (actor) => schedule.getToday.execute(actor),
    grades: (actor) => grades.getMyGrades.execute(actor),
    requests: (actor) => requests.listMyRequests.execute(actor),
    notifications: (actor) => notifications.getMyNotifications.execute(actor),
  },
  system.clock,
);

export const speech = createSpeechModule(today.getOverview, system);

export { assistant } from "./modules/assistant";
export { search } from "./modules/search";
export const { getConcept } = shared;
export { attendanceUseCases as attendance } from "./modules/attendance";
export { onboarding } from "./modules/onboarding";
