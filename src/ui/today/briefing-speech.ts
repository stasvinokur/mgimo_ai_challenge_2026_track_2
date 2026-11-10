import { briefingMessages } from "@/ui/i18n/dictionaries/today";
import { formatNumber } from "@/ui/i18n/format";
import type { Language } from "@/ui/i18n/language";
import { t } from "@/ui/i18n/translate";

export interface BriefingSpeechState {
  current: number | null;
  status: string;
}

export function selectBriefingVoice(
  voices: readonly SpeechSynthesisVoice[],
  language: Language,
) {
  const prefix = language === "en" ? /^en(?:[-_]|$)/i : /^ru(?:[-_]|$)/i;
  return voices.find((voice) => prefix.test(voice.lang)) ?? null;
}

export function createBriefingReader(
  synth: Pick<SpeechSynthesis, "speak" | "cancel">,
  createUtterance: (text: string) => SpeechSynthesisUtterance,
  update: (state: BriefingSpeechState) => void,
  language: Language = "ru",
) {
  let generation = 0;
  let utterance: SpeechSynthesisUtterance | null = null;
  let text = "";

  function cancel() {
    generation++;
    if (utterance) {
      utterance = null;
      synth.cancel();
    }
  }

  function stop(status = t(language, briefingMessages, "stopped")) {
    cancel();
    update({ current: null, status });
  }

  function listen(
    phrases: readonly string[],
    voice: SpeechSynthesisVoice,
    startIndex = 0,
    prefix = "",
  ) {
    cancel();
    text = phrases.join("\n");
    const run = generation;
    function speak(index: number) {
      if (generation !== run) return;
      const phrase = phrases[index];
      if (!phrase) {
        utterance = null;
        update({
          current: null,
          status: t(language, briefingMessages, "finished"),
        });
        return;
      }
      const next = createUtterance(phrase);
      next.lang = voice.lang;
      next.voice = voice;
      const state = {
        current: index,
        status:
          prefix +
          t(language, briefingMessages, "reading", {
            current: formatNumber(language, index + 1),
            total: formatNumber(language, phrases.length),
          }),
      };
      next.onstart = () => {
        if (generation === run) update(state);
      };
      next.onend = () => speak(index + 1);
      next.onerror = () => {
        if (generation !== run) return;
        stop(t(language, briefingMessages, "speechError"));
      };
      utterance = next;
      update(state);
      synth.speak(next);
    }
    speak(startIndex);
  }

  return {
    listen,
    stop,
    cancel,
    get reading() {
      return utterance !== null;
    },
    get text() {
      return text;
    },
  };
}
