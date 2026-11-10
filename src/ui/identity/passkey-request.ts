"use client";

import { appPath } from "@/ui/shared/app-path.mjs";

type PasskeyRequestErrorCode =
  | "PASSKEY_REAUTHENTICATION_REQUIRED"
  | "PASSKEY_LIMIT_REACHED"
  | "RATE_LIMITED";

export class PasskeyRequestError extends Error {
  constructor(
    readonly code: PasskeyRequestErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export async function passkeyRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(appPath(`/api/passkeys${path}`), {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    if (data && typeof data === "object" && "error" in data) {
      const error = data.error;
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        "message" in error &&
        typeof error.message === "string" &&
        (error.code === "PASSKEY_REAUTHENTICATION_REQUIRED" ||
          error.code === "PASSKEY_LIMIT_REACHED" ||
          error.code === "RATE_LIMITED")
      )
        throw new PasskeyRequestError(error.code, error.message);
    }
    throw new Error("PASSKEY_REQUEST_FAILED");
  }
  return data as T;
}
