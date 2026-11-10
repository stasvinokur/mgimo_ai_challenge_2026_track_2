import type { Clock } from "@/application/ports/clock";

export class FakeClock implements Clock {
  private timestamp: number;

  constructor(initial: Date | string) {
    this.timestamp = new Date(initial).getTime();
  }

  now(): Date {
    return new Date(this.timestamp);
  }

  set(instant: Date | string): void {
    this.timestamp = new Date(instant).getTime();
  }

  advance(milliseconds: number): void {
    this.timestamp += milliseconds;
  }
}
