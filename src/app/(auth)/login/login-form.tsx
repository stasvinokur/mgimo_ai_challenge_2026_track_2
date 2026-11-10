"use client";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { login } from "@/app/(auth)/actions";
import type { DemoAccount } from "@/application/identity/demo-accounts";
import { loginMessages } from "@/ui/i18n/dictionaries/login";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { PasskeyLogin } from "@/ui/identity/passkey-login";
import { Button } from "@/ui/primitives/button";

export function LoginForm({
  next,
  accounts,
}: {
  next: string | null;
  accounts: readonly Pick<DemoAccount, "login" | "password" | "displayName">[];
}) {
  const language = useLanguage();
  const [state, action, pending] = useActionState(login.bind(null, next), {});
  const [userLogin, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [passkeyPending, setPasskeyPending] = useState(false);
  const busy = pending || passkeyPending;
  const errors = state.error?.fieldErrors;
  const translatedError = state.error
    ? t(
        language,
        loginMessages,
        errors?.credentials
          ? "invalidCredentials"
          : state.error.code === "RATE_LIMITED"
            ? "rateLimited"
            : state.error.code === "VALIDATION"
              ? "invalidForm"
              : "failed",
      )
    : "";
  useEffect(() => {
    if (state.error)
      toast.error(
        language === "en"
          ? translatedError
          : (state.error.fieldErrors?.credentials?.join(" ") ??
              state.error.message),
      );
  }, [state.error, language, translatedError]);
  return (
    <div className="flex flex-col gap-6">
      <form action={action} className="flex flex-col gap-4" aria-busy={busy}>
        <div className="flex flex-col gap-2">
          <label htmlFor="login" className="text-sm font-medium">
            {t(language, loginMessages, "login")}
          </label>
          <input
            id="login"
            name="login"
            autoComplete="username webauthn"
            autoCapitalize="none"
            spellCheck={false}
            required
            disabled={busy}
            maxLength={64}
            value={userLogin}
            onChange={(event) => setLogin(event.target.value)}
            aria-invalid={Boolean(errors?.login)}
            aria-describedby={errors?.login ? "login-error" : undefined}
            className="min-h-11 min-w-0 rounded-lg border border-input bg-background px-3 py-2"
          />
          {errors?.login && (
            <p id="login-error" className="text-sm text-destructive">
              {language === "en"
                ? t(language, loginMessages, "invalidLogin")
                : errors.login.join(" ")}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="password" className="text-sm font-medium">
            {t(language, loginMessages, "password")}
          </label>
          <input
            id="password"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            disabled={busy}
            maxLength={1024}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(errors?.password)}
            aria-describedby={errors?.password ? "password-error" : undefined}
            className="min-h-11 min-w-0 rounded-lg border border-input bg-background px-3 py-2"
          />
          {errors?.password && (
            <p id="password-error" className="text-sm text-destructive">
              {language === "en"
                ? t(language, loginMessages, "invalidPassword")
                : errors.password.join(" ")}
            </p>
          )}
        </div>
        {state.error && (
          <p role="alert" className="text-sm text-destructive">
            {language === "en"
              ? translatedError
              : (errors?.credentials?.join(" ") ??
                (state.error.code === "RATE_LIMITED"
                  ? t(language, loginMessages, "rateLimited")
                  : state.error.message))}
          </p>
        )}
        <Button
          type="submit"
          disabled={busy}
          className="h-auto whitespace-normal"
        >
          {t(language, loginMessages, pending ? "pending" : "submit")}
        </Button>
      </form>
      <PasskeyLogin
        next={next}
        disabled={pending}
        onPendingChange={setPasskeyPending}
      />
      {accounts.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {t(language, loginMessages, "demoHint")}
          </p>
          {accounts.map((account) => (
            <Button
              key={account.login}
              type="button"
              variant="secondary"
              className="h-auto whitespace-normal"
              disabled={busy}
              onClick={() => {
                setLogin(account.login);
                setPassword(account.password);
              }}
            >
              {t(language, loginMessages, "demoAccount", {
                name: account.displayName,
              })}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
