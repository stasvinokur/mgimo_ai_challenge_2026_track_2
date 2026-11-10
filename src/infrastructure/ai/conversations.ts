import { AssistantBusyError } from "@/application/assistant/errors";
import type {
  AssistantConversations,
  Conversation,
} from "@/application/assistant/ports";
import type { Clock } from "@/application/ports/clock";
import { NotFoundError, RateLimitedError } from "@/application/shared/errors";

interface Entry {
  userId: string;
  state: Conversation;
  at: number;
  busy: boolean;
}

export class MemoryAssistantConversations implements AssistantConversations {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly clock: Clock) {}
  private evictOldest(userId?: string) {
    let oldest: [string, Entry] | undefined;
    for (const candidate of this.entries) {
      const [, entry] = candidate;
      if (
        entry.busy ||
        entry.state.pending ||
        (userId !== undefined && entry.userId !== userId)
      )
        continue;
      if (!oldest || entry.at < oldest[1].at) oldest = candidate;
    }
    if (!oldest) return false;
    this.entries.delete(oldest[0]);
    return true;
  }
  acquire(userId: string, threadId: string, create = true) {
    const now = this.clock.now().getTime();
    for (const [key, entry] of this.entries)
      if (!entry.busy && entry.at < now - 1_800_000) this.entries.delete(key);
    const key = `${userId}:${threadId}`;
    let entry = this.entries.get(key);
    if (!entry && !create) throw new NotFoundError();
    if (entry?.busy) throw new AssistantBusyError();
    if (!entry) {
      // Pending approvals survive the per-user soft limit until the conversation TTL.
      if (
        [...this.entries.values()].filter((value) => value.userId === userId)
          .length >= 5
      )
        this.evictOldest(userId);
      if (this.entries.size >= 500 && !this.evictOldest())
        throw new RateLimitedError();
      entry = { userId, state: { history: [] }, at: now, busy: false };
      this.entries.set(key, entry);
    }
    entry.busy = true;
    entry.at = now;
    const active = entry;
    return {
      state: active.state,
      release: () => {
        active.busy = false;
        active.at = this.clock.now().getTime();
      },
    };
  }
}
