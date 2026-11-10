import type { ReactNode } from "react";
import { requireTeacher } from "@/app/_lib/get-actor";
import { AppShell } from "@/ui/shell/app-shell";

export default async function Layout({ children }: { children: ReactNode }) {
  await requireTeacher();
  return <AppShell audience="teacher">{children}</AppShell>;
}
