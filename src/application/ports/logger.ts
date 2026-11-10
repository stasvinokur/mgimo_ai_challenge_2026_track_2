export interface LogContext {
  user_id?: string;
  code?: string;
  status?: number;
  duration_ms?: number;
}

export interface Logger {
  // Events are fixed developer-defined codes, never user input or Error.message.
  info(event: string, context?: LogContext): void;
  warn(event: string, context?: LogContext): void;
  error(event: string, context?: LogContext): void;
}
