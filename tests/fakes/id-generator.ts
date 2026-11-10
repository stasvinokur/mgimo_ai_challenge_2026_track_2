import type { IdGenerator } from "@/application/ports/id-generator";

export class SequentialIdGenerator implements IdGenerator {
  private sequence = 0;

  next(): string {
    this.sequence += 1;
    return `00000000-0000-7000-8000-${this.sequence.toString(16).padStart(12, "0")}`;
  }
}
