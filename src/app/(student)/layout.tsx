import type { ReactNode } from "react";
import { requireStudent } from "@/app/_lib/get-actor";
import type { PulseDto } from "@/application/notifications/ports";
import { notifications, system } from "@/composition/container";
import { LivePulse } from "@/ui/notifications/live-pulse";
import { AppShell } from "@/ui/shell/app-shell";
import { latestNotificationTitleAction } from "./notifications/actions";
import { getRequestProfileAction } from "./requests/actions";

export default async function Layout({ children }: { children: ReactNode }) {
  // Keep this check outside Suspense so redirects precede streamed HTML.
  const actor = await requireStudent();
  let pulse: PulseDto | null = null;
  try {
    pulse = await notifications.getMyPulse.execute(actor);
  } catch {
    system.logger.error("student_pulse_unavailable", {
      code: "PULSE_UNAVAILABLE",
    });
  }
  return (
    <AppShell
      audience="student"
      unreadNotifications={pulse?.unread ?? null}
      requestProfileAction={getRequestProfileAction}
    >
      <LivePulse initial={pulse} latestTitle={latestNotificationTitleAction} />
      {children}
    </AppShell>
  );
}
