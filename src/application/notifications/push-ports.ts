import type {
  PushResult,
  PushSubscription,
} from "@/application/ports/push-sender";

export interface StoredPushSubscription extends PushSubscription {
  id: string;
}

export interface PendingPushNotification {
  id: string;
  kind: string;
  link: string;
}

export interface TeacherPushRecipient {
  userId: string;
  slotId: string;
  occurrenceDate: string;
  entryKey: string;
}

export interface TeacherPushAccess {
  canNotifyStudent(
    teacherId: string,
    recipient: TeacherPushRecipient,
  ): Promise<boolean>;
}

export interface PushSubscriptionsRepository {
  listForUser(userId: string): Promise<StoredPushSubscription[]>;
  saveForUser(userId: string, subscription: PushSubscription): Promise<boolean>;
  deleteForUser(userId: string, endpoint: string): Promise<boolean>;
  recordResultForUser(
    userId: string,
    subscription: StoredPushSubscription,
    status: PushResult["status"],
  ): Promise<void>;
}

export interface PushQueue {
  claimForUser(
    userId: string,
    since: string,
    at: string,
  ): Promise<PendingPushNotification[]>;
  findUserForStaffRequest(
    requestId: string,
    facultyIds: readonly string[],
  ): Promise<string | null>;
}
