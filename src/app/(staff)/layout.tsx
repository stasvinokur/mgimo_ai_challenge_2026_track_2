import type { ReactNode } from "react";
import { requireStaff } from "@/app/_lib/get-actor";
import { AppShell } from "@/ui/shell/app-shell";

export default async function Layout({ children }: { children: ReactNode }) {
  // Keep this check outside Suspense so forbidden() can send HTTP 403.
  await requireStaff();
  return <AppShell audience="staff">{children}</AppShell>;
}
