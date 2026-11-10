import type {
  NotificationKind,
  NotificationPriority,
} from "@/domain/notifications/quiet-mode";

export interface NotificationDto {
  id: string;
  kind: NotificationKind;
  priority: NotificationPriority;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface AnnouncementDto {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
}

export interface PulseDto {
  unread: number;
  latestAt: string | null;
}

export interface NotificationsRepository {
  listForUser(userId: string): Promise<NotificationDto[]>;
  findByIdForUser(id: string, userId: string): Promise<NotificationDto | null>;
  markReadForUser(id: string, userId: string, at: string): Promise<boolean>;
  markAllReadForUser(userId: string, at: string): Promise<void>;
  getPulseForUser(userId: string): Promise<PulseDto>;
  findLatestForUser(userId: string): Promise<NotificationDto | null>;
  listAnnouncementsForStudent(
    studentId: string,
    userId: string,
  ): Promise<AnnouncementDto[]>;
}
