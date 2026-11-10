"use client";

import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import {
  browserSupportsWebAuthn,
  startRegistration,
} from "@simplewebauthn/browser";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useState } from "react";
import type { PasskeyDto } from "@/application/identity/passkeys";
import { identityMessages } from "@/ui/i18n/dictionaries/identity";
import { formatDate } from "@/ui/i18n/format";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { useProfileAnchor } from "@/ui/onboarding/profile-anchor";
import { Button } from "@/ui/primitives/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/ui/primitives/card";
import { PasskeyRequestError, passkeyRequest } from "./passkey-request";

function KeyDate({ value }: { value: string }) {
  const language = useLanguage();
  return (
    <time dateTime={value}>
      {formatDate(language, value, { dateStyle: "medium", timeStyle: "short" })}{" "}
      {t(language, identityMessages, "moscowTime")}
    </time>
  );
}

export function PasskeyCard() {
  const language = useLanguage();
  const pathname = usePathname();
  const profilePath = pathname === "/staff/profile" ? pathname : "/profile";
  const titleId = useId();
  const nameId = useId();
  const [credentials, setCredentials] = useState<PasskeyDto[]>([]);
  const [isDemoAccount, setIsDemoAccount] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const initialLoading = loading && !initialized;
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<keyof typeof identityMessages | "">("");
  const [reauthenticationRequired, setReauthenticationRequired] =
    useState(false);
  const [notice, setNotice] = useState<keyof typeof identityMessages | "">("");
  const [deviceName, setDeviceName] = useState("");
  const [pending, setPending] = useState(false);
  const [supported, setSupported] = useState(false);
  useProfileAnchor("passkeys");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await passkeyRequest<{
        credentials: PasskeyDto[];
        isDemoAccount: boolean;
      }>("");
      setCredentials(data.credentials);
      setIsDemoAccount(data.isDemoAccount === true);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setInitialized(true);
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
    void load();
  }, [load]);

  async function addKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    setReauthenticationRequired(false);
    setNotice("");
    try {
      const options =
        await passkeyRequest<PublicKeyCredentialCreationOptionsJSON>(
          "/registration/options",
          "POST",
          {},
        );
      const response = await startRegistration({ optionsJSON: options });
      await passkeyRequest("/registration/verify", "POST", {
        ...(isDemoAccount ? {} : { deviceName }),
        response,
      });
      setDeviceName("");
      setNotice("passkeyAdded");
      await load();
    } catch (error) {
      if (error instanceof PasskeyRequestError) {
        const needsLogin = error.code === "PASSKEY_REAUTHENTICATION_REQUIRED";
        setReauthenticationRequired(needsLogin);
        setError(
          needsLogin
            ? ""
            : error.code === "RATE_LIMITED"
              ? "passkeyRegistrationRateLimited"
              : "passkeyLimitReached",
        );
      } else {
        setError("passkeyAddFailed");
      }
    } finally {
      setPending(false);
    }
  }

  async function removeKey(id: string) {
    setPending(true);
    setError("");
    setNotice("");
    try {
      await passkeyRequest(`/${id}`, "DELETE");
      setNotice("passkeyRemoved");
      await load();
    } catch {
      setError("passkeyRemoveFailed");
    } finally {
      setPending(false);
    }
  }

  function deviceLabel(credential: PasskeyDto) {
    return isDemoAccount
      ? t(language, identityMessages, "demoPasskeyName")
      : credential.deviceName;
  }

  return (
    <section
      id="passkeys"
      aria-labelledby={titleId}
      className="min-w-0 scroll-mt-24"
      data-profile-anchor-ready={!initialLoading}
    >
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={titleId}>
              {t(language, identityMessages, "passkeysTitle")}
            </h2>
          </CardTitle>
          <CardDescription>
            {t(language, identityMessages, "passkeysDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-5">
          {initialLoading ? (
            <div role="status" className="space-y-2">
              <span className="sr-only">
                {t(language, identityMessages, "passkeysLoading")}
              </span>
              <div className="h-6 animate-pulse rounded bg-muted" />
              <div className="h-6 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          ) : loadError ? (
            <div
              role="alert"
              aria-busy={loading}
              className="flex flex-wrap items-center gap-3"
            >
              <p>{t(language, identityMessages, "passkeysLoadFailed")}</p>
              <Button
                type="button"
                variant="outline"
                disabled={loading}
                onClick={() => void load()}
              >
                {t(language, identityMessages, "retry")}
              </Button>
            </div>
          ) : credentials.length ? (
            <ul aria-busy={loading} className="grid min-w-0 gap-4">
              {credentials.map((credential) => (
                <li
                  key={credential.id}
                  className="flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0 flex-1 basis-44">
                    <p className="font-medium">{deviceLabel(credential)}</p>
                    <p className="text-sm text-muted-foreground">
                      {t(language, identityMessages, "created")}{" "}
                      <KeyDate value={credential.createdAt} />
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t(language, identityMessages, "lastUsed")}{" "}
                      {credential.lastUsedAt ? (
                        <KeyDate value={credential.lastUsedAt} />
                      ) : (
                        t(language, identityMessages, "neverUsed")
                      )}
                    </p>
                  </div>
                  {isDemoAccount === false && (
                    <Button
                      type="button"
                      variant="outline"
                      className="[overflow-wrap:normal]"
                      disabled={pending}
                      onClick={() => void removeKey(credential.id)}
                    >
                      {t(language, identityMessages, "remove")}
                      <span className="sr-only">
                        {" "}
                        {t(language, identityMessages, "keyName", {
                          name: deviceLabel(credential),
                        })}
                      </span>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p aria-busy={loading} className="text-sm text-muted-foreground">
              {t(language, identityMessages, "passkeysEmpty")}
            </p>
          )}
          {isDemoAccount === true && credentials.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {t(language, identityMessages, "demoPasskeyRemovalNotice")}
            </p>
          )}
          <form
            onSubmit={addKey}
            aria-busy={pending}
            aria-describedby={isDemoAccount ? nameId : undefined}
            className="flex min-w-0 flex-col gap-3"
          >
            {isDemoAccount === true ? (
              <p id={nameId} className="text-sm text-muted-foreground">
                {t(language, identityMessages, "demoPasskeyNotice")}
              </p>
            ) : isDemoAccount === false ? (
              <>
                <label
                  htmlFor={nameId}
                  className="text-sm font-medium [overflow-wrap:normal]"
                >
                  {t(language, identityMessages, "deviceName")}
                </label>
                <input
                  id={nameId}
                  name="deviceName"
                  value={deviceName}
                  onChange={(event) => setDeviceName(event.target.value)}
                  maxLength={64}
                  required
                  disabled={pending || !supported || reauthenticationRequired}
                  placeholder={t(
                    language,
                    identityMessages,
                    "deviceNamePlaceholder",
                  )}
                  className="min-h-11 min-w-0 rounded-lg border border-input bg-background px-3 py-2"
                />
              </>
            ) : null}
            <Button
              type="submit"
              variant="secondary"
              className="w-fit max-w-full [overflow-wrap:normal]"
              disabled={
                pending ||
                !supported ||
                loading ||
                loadError ||
                reauthenticationRequired
              }
            >
              {t(language, identityMessages, pending ? "wait" : "addKey")}
            </Button>
            {!supported && (
              <p className="text-sm text-muted-foreground">
                {t(language, identityMessages, "passkeysUnsupported")}
              </p>
            )}
          </form>
          {reauthenticationRequired && (
            <div
              role="alert"
              className="flex flex-col items-start gap-3 text-sm text-destructive"
            >
              <p>{t(language, identityMessages, "reauthenticationRequired")}</p>
              <Button
                asChild
                variant="outline"
                className="text-foreground [overflow-wrap:normal]"
              >
                <Link href={`/login?next=${encodeURIComponent(profilePath)}`}>
                  {t(language, identityMessages, "signInAgain")}
                </Link>
              </Button>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {t(language, identityMessages, error)}
            </p>
          )}
          {!initialLoading && (
            <p role="status" className="text-sm text-muted-foreground">
              {notice && t(language, identityMessages, notice)}
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
