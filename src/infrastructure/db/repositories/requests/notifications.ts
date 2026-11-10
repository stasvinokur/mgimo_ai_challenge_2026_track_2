import type { RequestNotifications } from "@/application/requests/ports";
import { notifications } from "../../schema/notifications";
import type { RequestsDatabase } from "./repository";

export class DrizzleRequestNotifications implements RequestNotifications {
  constructor(private readonly database: () => RequestsDatabase) {}
  async add(input: Parameters<RequestNotifications["add"]>[0]) {
    await this.database()
      .insert(notifications)
      .values({
        id: input.id,
        userId: input.userId,
        kind: "request",
        title: input.title,
        body: input.body,
        link: `/requests/${input.requestId}`,
        createdAt: new Date(input.at),
      });
  }
}
