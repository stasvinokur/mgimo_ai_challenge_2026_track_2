"use client";
import { useActionState } from "react";
import { logout } from "@/app/(auth)/actions";
import { identityMessages } from "@/ui/i18n/dictionaries/identity";
import type { Language } from "@/ui/i18n/language";
import { t } from "@/ui/i18n/translate";
import { clearPushBeforeLogout } from "@/ui/notifications/push-logout";
import { Button } from "@/ui/primitives/button";
import { clearPwaPages } from "@/ui/shell/pwa-client";

export function LogoutButton({
  language = "ru",
}: {
  language?: Language;
} = {}) {
  const [state, action, pending] = useActionState(
    async (previous: Parameters<typeof logout>[0]) => {
      await clearPushBeforeLogout().catch(() =>
        console.warn("PUSH_LOGOUT_CLEANUP_FAILED"),
      );
      await clearPwaPages().catch(() => console.warn("PWA_CACHE_CLEAR_FAILED"));
      return logout(previous);
    },
    {},
  );
  return (
    <form action={action} className="flex flex-col items-start gap-3">
      <Button type="submit" variant="outline" disabled={pending}>
        {t(language, identityMessages, pending ? "signingOut" : "signOut")}
      </Button>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error.message}
        </p>
      )}
    </form>
  );
}
