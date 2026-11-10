import type {
  AnnouncementDto,
  NotificationDto,
  NotificationsRepository,
} from "@/application/notifications/ports";

export class FakeNotificationsRepository implements NotificationsRepository {
  readonly items: (NotificationDto & { userId: string })[] = [];
  readonly profiles = new Map<
    string,
    { userId: string; faculty: string; course: string; group: string }
  >();
  readonly announcements: (AnnouncementDto & {
    audience: "all" | "faculty" | "course" | "group";
    ref: string | null;
  })[] = [];
  async listForUser(userId: string) {
    return this.items
      .filter((item) => item.userId === userId)
      .map(({ userId: _owner, ...item }) => ({ ...item }));
  }
  async findByIdForUser(id: string, userId: string) {
    return (
      (await this.listForUser(userId)).find((item) => item.id === id) ?? null
    );
  }
  async markReadForUser(id: string, userId: string, at: string) {
    const item = this.items.find(
      (item) => item.id === id && item.userId === userId,
    );
    if (!item) return false;
    item.readAt ??= at;
    return true;
  }
  async markAllReadForUser(userId: string, at: string) {
    for (const item of this.items)
      if (item.userId === userId) item.readAt ??= at;
  }
  async getPulseForUser(userId: string) {
    const items = await this.listForUser(userId);
    return {
      unread: items.filter((item) => !item.readAt).length,
      latestAt:
        items
          .flatMap((item) => [
            item.createdAt,
            ...(item.readAt ? [item.readAt] : []),
          ])
          .sort()
          .at(-1) ?? null,
    };
  }
  async findLatestForUser(userId: string) {
    return (
      (await this.listForUser(userId)).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      )[0] ?? null
    );
  }
  async listAnnouncementsForStudent(studentId: string, userId: string) {
    const profile = this.profiles.get(studentId);
    if (!profile || profile.userId !== userId) return [];
    return this.announcements
      .filter(
        (item) =>
          item.audience === "all" || profile[item.audience] === item.ref,
      )
      .map(({ audience: _audience, ref: _ref, ...item }) => item);
  }
}
