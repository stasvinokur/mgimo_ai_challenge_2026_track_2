import { describe, expect, it } from "vitest";
import { AssistantBusyError } from "@/application/assistant/errors";
import { NotFoundError, RateLimitedError } from "@/application/shared/errors";
import { MemoryAssistantConversations } from "@/infrastructure/ai/conversations";
import { FakeClock } from "../fakes/clock";

function fixture() {
  const clock = new FakeClock("2026-11-04T09:00:00Z");
  return { clock, store: new MemoryAssistantConversations(clock) };
}
describe("Диалоги ассистента: ограничение памяти и активных обращений", () => {
  it("approve только ищет: неизвестные threadId не создают и не вытесняют записи", () => {
    const { store, clock } = fixture();
    const states = Array.from({ length: 5 }, (_, i) => {
      const lease = store.acquire("student", `thread-${i}`);
      lease.release();
      clock.advance(1);
      return lease.state;
    });
    for (let i = 0; i < 600; i++)
      expect(() => store.acquire("student", `forged-${i}`, false)).toThrow(
        NotFoundError,
      );
    for (let i = 0; i < 5; i++) {
      const lease = store.acquire("student", `thread-${i}`, false);
      expect(lease.state).toBe(states[i]);
      lease.release();
    }
  });
  it("шестой диалог вытесняет старейший диалог только этого пользователя", () => {
    const { store, clock } = fixture();
    const other = store.acquire("other", "keep");
    other.release();
    for (let i = 0; i < 5; i++) {
      store.acquire("student", `thread-${i}`).release();
      clock.advance(1);
    }
    store.acquire("student", "thread-5").release();
    expect(() => store.acquire("student", "thread-0", false)).toThrow(
      NotFoundError,
    );
    const kept = store.acquire("other", "keep", false);
    expect(kept.state).toBe(other.state);
    kept.release();
    for (let i = 1; i <= 5; i++)
      store.acquire("student", `thread-${i}`, false).release();
  });
  it("при общем переполнении вытесняет старейший простой, сохраняя активный", () => {
    const { store, clock } = fixture();
    const busy = store.acquire("active", "keep");
    for (let i = 0; i < 499; i++) {
      clock.advance(1);
      store.acquire(`student-${i}`, "thread").release();
    }
    expect(() =>
      store.acquire("new-student", "thread").release(),
    ).not.toThrow();
    expect(() => store.acquire("student-0", "thread", false)).toThrow(
      NotFoundError,
    );
    busy.release();
    const kept = store.acquire("active", "keep", false);
    expect(kept.state).toBe(busy.state);
    kept.release();
    store.acquire("student-1", "thread", false).release();
  });
  it("занят только тот же диалог; другие диалоги пользователя и другой студент независимы", () => {
    const { store } = fixture();
    const first = store.acquire("student", "one");
    expect(() => store.acquire("student", "one")).toThrow(AssistantBusyError);
    const second = store.acquire("student", "two");
    expect(second.state).not.toBe(first.state);
    store.acquire("other", "one").release();
    first.release();
    expect(() => store.acquire("student", "one").release()).not.toThrow();
    second.release();
  });
  it("ожидающее подтверждение переживает шесть новых диалогов пользователя", () => {
    const { store, clock } = fixture();
    const pending = store.acquire("student", "pending");
    pending.state.pending = {
      id: "approval",
      draftId: "draft",
      updatedAt: clock.now().toISOString(),
      payload: {},
    };
    pending.release();
    for (let i = 0; i < 6; i++) {
      clock.advance(1);
      store.acquire("student", `new-${i}`).release();
    }
    const kept = store.acquire("student", "pending", false);
    expect(kept.state.pending).toBe(pending.state.pending);
    kept.release();
  });
  it("глобальное вытеснение тоже сохраняет ожидающее подтверждение", () => {
    const { store, clock } = fixture();
    const pending = store.acquire("student", "pending");
    pending.state.pending = {
      id: "approval",
      draftId: "draft",
      updatedAt: clock.now().toISOString(),
      payload: {},
    };
    pending.release();
    for (let i = 0; i < 499; i++) {
      clock.advance(1);
      store.acquire(`other-${i}`, "thread").release();
    }
    store.acquire("new-student", "thread").release();
    const kept = store.acquire("student", "pending", false);
    expect(kept.state.pending).toBe(pending.state.pending);
    kept.release();
    expect(() => store.acquire("other-0", "thread", false)).toThrow(
      NotFoundError,
    );
  });
  it("500 защищённых диалогов не вытесняются; после TTL память освобождается", () => {
    const { store, clock } = fixture();
    for (let i = 0; i < 500; i++) {
      const lease = store.acquire("student", `pending-${i}`);
      lease.state.pending = {
        id: `approval-${i}`,
        draftId: `draft-${i}`,
        updatedAt: clock.now().toISOString(),
        payload: {},
      };
      lease.release();
    }
    expect(() => store.acquire("student", "overflow")).toThrow(
      RateLimitedError,
    );
    store.acquire("student", "pending-0", false).release();
    clock.advance(1_800_001);
    store.acquire("student", "after-ttl").release();
    expect(() => store.acquire("student", "pending-0", false)).toThrow(
      NotFoundError,
    );
  });
  it("по истечении TTL approve не воссоздаёт потерянное подтверждение", () => {
    const { store, clock } = fixture();
    store.acquire("student", "old").release();
    clock.advance(1_800_001);
    expect(() => store.acquire("student", "old", false)).toThrow(NotFoundError);
  });
});
