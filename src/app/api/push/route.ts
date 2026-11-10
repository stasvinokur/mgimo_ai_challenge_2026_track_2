import { notifications } from "@/composition/container";
import { pushRoute } from "./handler";

export async function GET() {
  return pushRoute((actor) =>
    notifications.push.getConfiguration.execute(actor),
  );
}
