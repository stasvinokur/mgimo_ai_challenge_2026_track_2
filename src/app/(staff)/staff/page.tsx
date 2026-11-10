import { redirect } from "next/navigation";
import { requireStaff } from "@/app/_lib/get-actor";

export default async function Page() {
  await requireStaff();
  redirect("/staff/requests");
}
