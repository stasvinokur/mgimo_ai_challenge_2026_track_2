export interface RateLimitRule {
  key: string;
  limit: number;
  windowSec: number;
}

export interface RateLimitReservation {
  commitFailure(): Promise<void>;
  release(): Promise<void>;
}

export interface RateLimiter {
  reserve(
    rules: readonly RateLimitRule[],
  ): Promise<RateLimitReservation | null>;
}
