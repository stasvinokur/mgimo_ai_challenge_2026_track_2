import pino, { type DestinationStream } from "pino";
import type { LogContext, Logger } from "@/application/ports/logger";

const eventPattern = /^[a-z][a-z0-9_.-]{0,79}$/;
const codePattern = /^[A-Z][A-Z0-9_]{0,63}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const secretNames = ["password", "token", "cookie", "authorization"];

function safeContext(context: LogContext = {}): LogContext {
  // An allowlist also drops nested data, PII and every key containing "key".
  return {
    ...(typeof context.user_id === "string" && uuidPattern.test(context.user_id)
      ? { user_id: context.user_id }
      : {}),
    ...(typeof context.code === "string" && codePattern.test(context.code)
      ? { code: context.code }
      : {}),
    ...(Number.isFinite(context.status) ? { status: context.status } : {}),
    ...(Number.isFinite(context.duration_ms)
      ? { duration_ms: context.duration_ms }
      : {}),
  };
}

export function createPinoLogger(destination?: DestinationStream): Logger {
  const options: pino.LoggerOptions = {
    base: undefined,
    redact: {
      paths: secretNames.flatMap((name) => [name, `*.${name}`]),
      censor: "[REDACTED]",
    },
  };
  const logger = destination ? pino(options, destination) : pino(options);
  function write(
    level: "info" | "warn" | "error",
    event: string,
    context?: LogContext,
  ) {
    logger[level](
      safeContext(context),
      eventPattern.test(event) ? event : "invalid_event",
    );
  }
  return {
    info: (event, context) => write("info", event, context),
    warn: (event, context) => write("warn", event, context),
    error: (event, context) => write("error", event, context),
  };
}
