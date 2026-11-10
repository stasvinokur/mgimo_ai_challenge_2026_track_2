import { expect, it, vi } from "vitest";
import type { Language } from "@/ui/i18n/language";
import {
  createBriefingReader,
  selectBriefingVoice,
} from "@/ui/today/briefing-speech";

function fixture(language: Language = "ru") {
  const spoken: SpeechSynthesisUtterance[] = [];
  const voice = { name: "Milena", lang: "ru-RU" } as SpeechSynthesisVoice;
  const update = vi.fn();
  const synth = {
    speak: vi.fn((utterance: SpeechSynthesisUtterance) =>
      spoken.push(utterance),
    ),
    cancel: vi.fn(),
  };
  const reader = createBriefingReader(
    synth,
    (text) => ({ text }) as SpeechSynthesisUtterance,
    update,
    language,
  );
  function event(index: number, type: "start" | "end" | "error") {
    const utterance = spoken[index];
    if (!utterance) throw new Error("Фраза должна быть поставлена на чтение.");
    if (type === "error")
      utterance.onerror?.call(utterance, {} as SpeechSynthesisErrorEvent);
    else
      utterance[type === "start" ? "onstart" : "onend"]?.call(
        utterance,
        {} as SpeechSynthesisEvent,
      );
  }
  return { reader, synth, spoken, event, update, voice };
}

it("нет автозапуска; один utterance за раз, весь текст и ru-RU, короткий статус", () => {
  const d = fixture();
  expect(d.synth.speak).not.toHaveBeenCalled();
  const phrases = [
    "Через 5 минут — история, аудитория 312.",
    "Главное: справка готова.",
    "Стипендия сохраняется.",
  ];
  d.reader.listen(phrases, d.voice);
  expect(d.spoken).toHaveLength(1);
  expect(d.reader.reading).toBe(true);
  expect(d.reader.text).toBe(phrases.join("\n"));
  for (let i = 0; i < phrases.length; i++) {
    expect(d.spoken[i]).toMatchObject({
      text: phrases[i],
      lang: "ru-RU",
      voice: d.voice,
    });
    d.event(i, "start");
    expect(d.update).toHaveBeenLastCalledWith({
      current: i,
      status: `Читается фраза ${i + 1} из 3.`,
    });
    d.event(i, "end");
    expect(d.spoken.length).toBe(Math.min(i + 2, 3));
  }
  expect(d.reader.reading).toBe(false);
  expect(d.update).toHaveBeenLastCalledWith({
    current: null,
    status: "Сводка прочитана.",
  });
});

it.each(["start", "end", "error"] as const)(
  "Стоп: запоздавший %s не меняет статус и не продолжает речь",
  (event) => {
    const d = fixture();
    d.reader.listen(["Первая.", "Вторая."], d.voice);
    d.reader.stop();
    expect(d.synth.cancel).toHaveBeenCalledOnce();
    expect(d.reader.reading).toBe(false);
    d.update.mockClear();
    d.event(0, event);
    expect(d.spoken).toHaveLength(1);
    expect(d.update).not.toHaveBeenCalled();
  },
);

it("синхронный end внутри cancel тоже не запускает следующую фразу", () => {
  const d = fixture();
  d.synth.cancel.mockImplementation(() => d.event(0, "end"));
  d.reader.listen(["Первая.", "Вторая."], d.voice);
  d.reader.stop();
  expect(d.spoken).toHaveLength(1);
  expect(d.update).toHaveBeenLastCalledWith({
    current: null,
    status: "Чтение остановлено.",
  });
});

it("новое чтение не принимает старые события; смена текста допускает повтор", () => {
  const d = fixture();
  d.reader.listen(["Старая первая.", "Старая вторая."], d.voice);
  d.reader.listen(["Новая первая.", "Новая вторая."], d.voice);
  d.update.mockClear();
  for (const type of ["end", "start", "error"] as const) d.event(0, type);
  expect(d.update).not.toHaveBeenCalled();
  expect(d.spoken.map((item) => item.text)).toEqual([
    "Старая первая.",
    "Новая первая.",
  ]);
  d.event(1, "end");
  expect(d.spoken[2]?.text).toBe("Новая вторая.");
  d.reader.stop("Сводка обновилась. Можно послушать снова.");
  expect(d.update).toHaveBeenLastCalledWith({
    current: null,
    status: "Сводка обновилась. Можно послушать снова.",
  });
});

it("очистка при размонтировании отменяет без обновления React, события уже не действуют", () => {
  const d = fixture();
  d.reader.listen(["Первая.", "Вторая."], d.voice);
  d.update.mockClear();
  d.reader.cancel();
  d.event(0, "end");
  expect(d.synth.cancel).toHaveBeenCalledOnce();
  expect(d.update).not.toHaveBeenCalled();
  expect(d.spoken).toHaveLength(1);
});

it("ошибка речи прекращает цепочку и позволяет начать снова", () => {
  const d = fixture();
  d.reader.listen(["Первая.", "Вторая."], d.voice);
  d.event(0, "error");
  expect(d.reader.reading).toBe(false);
  expect(d.update).toHaveBeenLastCalledWith({
    current: null,
    status:
      "Не удалось озвучить. Можно попробовать снова или прочитать сводку.",
  });
  d.event(0, "end");
  expect(d.spoken).toHaveLength(1);
  d.reader.listen(["Повтор."], d.voice);
  expect(d.spoken[1]?.text).toBe("Повтор.");
});

it("English выбирает только английский голос, независимо от порядка голосов машины", () => {
  const russian = { lang: "ru-RU", name: "Russian" } as SpeechSynthesisVoice;
  const english = { lang: "en-GB", name: "English" } as SpeechSynthesisVoice;
  const other = { lang: "fr-FR", name: "French" } as SpeechSynthesisVoice;
  expect(selectBriefingVoice([russian, other, english], "en")).toBe(english);
  expect(selectBriefingVoice([english, russian], "ru")).toBe(russian);
  expect(selectBriefingVoice([russian, other], "en")).toBeNull();
  expect(selectBriefingVoice([], "en")).toBeNull();
  expect(
    selectBriefingVoice([{ lang: "english" } as SpeechSynthesisVoice], "en"),
  ).toBeNull();
  expect(
    selectBriefingVoice([{ lang: "EN_us" } as SpeechSynthesisVoice], "en")
      ?.lang,
  ).toBe("EN_us");
});

it("English озвучивает полным языком выбранного голоса и переводит статусы", () => {
  const d = fixture("en");
  const voice = { lang: "en-US", name: "Test English" } as SpeechSynthesisVoice;
  d.reader.listen(["First.", "Second."], voice);
  expect(d.spoken[0]).toMatchObject({ lang: "en-US", voice, text: "First." });
  expect(d.update).toHaveBeenLastCalledWith({
    current: 0,
    status: "Reading phrase 1 of 2.",
  });
  d.event(0, "end");
  d.event(1, "end");
  expect(d.update).toHaveBeenLastCalledWith({
    current: null,
    status: "Briefing finished.",
  });
  d.reader.listen(["Again."], voice);
  d.reader.stop();
  expect(d.update).toHaveBeenLastCalledWith({
    current: null,
    status: "Reading stopped.",
  });
  d.event(2, "end");
  expect(d.spoken).toHaveLength(3);
  d.reader.listen(["Retry."], voice);
  d.event(3, "error");
  expect(d.update).toHaveBeenLastCalledWith({
    current: null,
    status: "Could not read aloud. Try again or read the briefing.",
  });
});
