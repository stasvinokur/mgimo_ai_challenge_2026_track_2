import { notifications } from "@/composition/container";
import { pushRoute } from "../handler";

export async function POST(request: Request) {
  return pushRoute(
    (actor, input) => notifications.push.test.execute(actor, input),
    request,
  );
}
