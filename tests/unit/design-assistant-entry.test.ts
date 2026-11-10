import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ASSISTANT_OPEN_EVENT,
  createAssistantQuestionSender,
  openAssistant,
  subscribeAssistantEntry,
} from "@/ui/shell/assistant-entry";

afterEach(() => vi.unstubAllGlobals());

describe("единая точка входа ассистента", () => {
  it("передаёт вопрос существующему подписчику и снимает подписку", () => {
    vi.stubGlobal("window", new EventTarget());
    const open = vi.fn();
    const unsubscribe = subscribeAssistantEntry(open);
    openAssistant("Где следующая пара?");
    expect(open).toHaveBeenCalledExactlyOnceWith("Где следующая пара?");
    openAssistant();
    expect(open).toHaveBeenLastCalledWith(undefined);
    window.dispatchEvent(
      new CustomEvent(ASSISTANT_OPEN_EVENT, { detail: { question: 3 } }),
    );
    window.dispatchEvent(new Event(ASSISTANT_OPEN_EVENT));
    expect(open).toHaveBeenCalledTimes(2);
    unsubscribe();
    openAssistant("Уже без подписки");
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("два события до обновления React дают один запрос; после ответа доступен следующий", async () => {
    vi.stubGlobal("window", new EventTarget());
    let finish = () => {};
    const send = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const clearError = vi.fn();
    const ask = createAssistantQuestionSender({
      isBusy: () => false,
      clearError,
      send,
    });
    const results: Promise<boolean>[] = [];
    const unsubscribe = subscribeAssistantEntry((question) => {
      if (question) results.push(ask(question));
    });
    openAssistant("  Где следующая пара?  ");
    openAssistant("Есть ли долги?");
    expect(send).toHaveBeenCalledExactlyOnceWith("Где следующая пара?");
    expect(clearError).toHaveBeenCalledOnce();
    finish();
    expect(await Promise.all(results)).toEqual([true, false]);
    const next = ask("Есть ли долги?");
    expect(send).toHaveBeenCalledTimes(2);
    finish();
    expect(await next).toBe(true);
    unsubscribe();
  });

  it("не отправляет во время ответа из чипа и не принимает пустой/слишком длинный вопрос", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    let busy = true;
    const ask = createAssistantQuestionSender({
      isBusy: () => busy,
      clearError: vi.fn(),
      send,
    });
    expect(await ask("Есть ли долги?")).toBe(false);
    busy = false;
    expect(await ask(" ")).toBe(false);
    expect(await ask("а".repeat(2001))).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(await ask("Есть ли долги?")).toBe(true);
  });

  it("ошибка отправки не блокирует повтор", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("Сеть"))
      .mockResolvedValue(undefined);
    const ask = createAssistantQuestionSender({
      isBusy: () => false,
      clearError: vi.fn(),
      send,
    });
    await expect(ask("Что изменилось?")).rejects.toThrow("Сеть");
    expect(await ask("Что изменилось?")).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
