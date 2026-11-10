"use client";

import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import {
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { loginMessages } from "@/ui/i18n/dictionaries/login";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { appPath } from "@/ui/shared/app-path.mjs";
import { passkeyRequest } from "./passkey-request";

export function PasskeyLogin({
  next,
  disabled,
  onPendingChange,
}: {
  next: string | null;
  disabled: boolean;
  onPendingChange: (pending: boolean) => void;
}) {
  const language = useLanguage();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const optionsCreatedAt = useRef(0);
  const options = useRef<Promise<PublicKeyCredentialRequestOptionsJSON> | null>(
    null,
  );
  const updatePending = useCallback(
    (value: boolean) => {
      busy.current = value;
      setPending(value);
      onPendingChange(value);
    },
    [onPendingChange],
  );
  const getOptions = useCallback(() => {
    if (!options.current || Date.now() - optionsCreatedAt.current >= 240_000) {
      optionsCreatedAt.current = Date.now();
      options.current = passkeyRequest<PublicKeyCredentialRequestOptionsJSON>(
        "/authentication/options",
        "POST",
        {},
      );
    }
    return options.current;
  }, []);

  const authenticate = useCallback(
    async (autofill: boolean, current: number) => {
      let navigating = false;
      let selectedCredential = false;
      try {
        const optionsJSON = await getOptions();
        if (generation.current !== current) return;
        const response = await startAuthentication({
          optionsJSON,
          useBrowserAutofill: autofill,
        });
        if (generation.current !== current) return;
        selectedCredential = true;
        updatePending(true);
        const result = await passkeyRequest<{ destination: string }>(
          "/authentication/verify",
          "POST",
          { response, next },
        );
        if (generation.current === current) {
          window.location.assign(appPath(result.destination));
          navigating = true;
        }
      } catch {
        if (generation.current === current) {
          options.current = null;
          if (!autofill || selectedCredential) setError("passkeyError");
        }
      } finally {
        if (generation.current === current && !navigating) updatePending(false);
      }
    },
    [getOptions, next, updatePending],
  );

  useEffect(() => {
    setReady(true);
    if (disabled) return;
    const current = ++generation.current;
    let refresh: ReturnType<typeof setTimeout> | undefined;
    function waitForAutofill(attempt: number) {
      void authenticate(true, attempt);
      refresh = setTimeout(() => {
        if (generation.current !== attempt || busy.current) return;
        WebAuthnAbortService.cancelCeremony();
        options.current = null;
        waitForAutofill(++generation.current);
      }, 240_000);
    }
    void browserSupportsWebAuthnAutofill()
      .catch(() => false)
      .then((available) => {
        if (available && generation.current === current)
          waitForAutofill(current);
      });
    return () => {
      ++generation.current;
      clearTimeout(refresh);
      WebAuthnAbortService.cancelCeremony();
      updatePending(false);
    };
  }, [authenticate, disabled, updatePending]);

  return (
    <div className="flex min-w-0 flex-col gap-3" aria-busy={pending}>
      <Button
        type="button"
        variant="outline"
        disabled={!ready || disabled || pending}
        className="max-w-full [overflow-wrap:normal]"
        onClick={() => {
          const current = ++generation.current;
          WebAuthnAbortService.cancelCeremony();
          updatePending(true);
          setError("");
          void authenticate(false, current);
        }}
      >
        {t(language, loginMessages, pending ? "pending" : "passkey")}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(language, loginMessages, "passkeyError")}
        </p>
      )}
    </div>
  );
}
