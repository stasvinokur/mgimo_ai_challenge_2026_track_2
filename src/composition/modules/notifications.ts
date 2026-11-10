import "server-only";
import {
  DispatchPush,
  GetPushConfiguration,
  SubscribeToPush,
  TestPush,
  UnsubscribeFromPush,
} from "@/application/notifications/push";
import { TeacherGradePushAccess } from "@/application/notifications/push-teacher";
import {
  GetLatestNotificationTitle,
  GetMyNotifications,
  GetMyPulse,
  ReadAllMyNotifications,
  ReadMyNotification,
} from "@/application/notifications/use-cases";
import { getDatabase } from "@/infrastructure/db/client";
import { PostgresRateLimiter } from "@/infrastructure/db/repositories/identity/rate-limiter";
import { PostgresPushRepository } from "@/infrastructure/db/repositories/notifications/push";
import { PostgresNotificationsRepository } from "@/infrastructure/db/repositories/notifications/repository";
import { PostgresTeacherGradebookUnitOfWork } from "@/infrastructure/db/repositories/teacher/gradebook";
import { createPushSender } from "./push";
import type { createSystemModule } from "./system";

export function createNotificationsModule(
  system: ReturnType<typeof createSystemModule>,
) {
  const repository = new PostgresNotificationsRepository(getDatabase);
  const pushRepository = new PostgresPushRepository(getDatabase, system.ids);
  const limiter = new PostgresRateLimiter(
    getDatabase,
    system.clock,
    system.ids,
  );
  return {
    push: {
      getAppOrigin: () => system.getEnv("APP_ORIGIN"),
      getConfiguration: new GetPushConfiguration(pushRepository, () =>
        createPushSender().enabled
          ? (system.getEnv("VAPID_PUBLIC_KEY") ?? null)
          : null,
      ),
      subscribe: new SubscribeToPush(pushRepository, createPushSender, limiter),
      unsubscribe: new UnsubscribeFromPush(pushRepository, limiter),
      test: new TestPush(
        pushRepository,
        createPushSender,
        limiter,
        system.logger,
      ),
      dispatch: new DispatchPush(
        pushRepository,
        createPushSender,
        system.clock,
        system.logger,
        new TeacherGradePushAccess(
          new PostgresTeacherGradebookUnitOfWork(getDatabase, system.ids),
          system.clock,
        ),
      ),
    },
    getMyNotifications: new GetMyNotifications(repository),
    getMyPulse: new GetMyPulse(repository),
    getLatestTitle: new GetLatestNotificationTitle(repository),
    readMyNotification: new ReadMyNotification(repository, system.clock),
    readAllMyNotifications: new ReadAllMyNotifications(
      repository,
      system.clock,
    ),
  };
}
