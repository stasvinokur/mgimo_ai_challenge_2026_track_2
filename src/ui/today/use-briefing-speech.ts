"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { briefingMessages } from "@/ui/i18n/dictionaries/today";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import type { BriefingPhrase } from "./briefing";
import {
  createBriefingAudioReader,
  createWebAudioOutput,
} from "./briefing-audio";
import {
  type BriefingSpeechState,
  createBriefingReader,
  selectBriefingVoice,
} from "./briefing-speech";

export function useBriefingSpeech(
  phrases: readonly BriefingPhrase[],
  serverSpeech = false,
) {
  const language = useLanguage();
  const serverEnabled = serverSpeech && language === "ru";
  const [ready, setReady] = useState(false);
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<BriefingSpeechState>({
    current: null,
    status: "",
  });
  const readerRef = useRef<ReturnType<typeof createBriefingReader> | null>(
    null,
  );
  const audioRef = useRef<ReturnType<typeof createBriefingAudioReader> | null>(
    null,
  );
  const phrasesRef = useRef(phrases);
  const voiceRef = useRef(voice);
  const stop = useCallback(() => {
    audioRef.current?.cancel();
    readerRef.current?.cancel();
    setState({
      current: null,
      status: t(language, briefingMessages, "stopped"),
    });
  }, [language]);

  useEffect(() => {
    setReady(true);
    setState({ current: null, status: "" });
    const synth = window.speechSynthesis;
    const browserSupported = Boolean(synth && window.SpeechSynthesisUtterance);
    setSupported(browserSupported);
    const reader = browserSupported
      ? createBriefingReader(
          synth,
          (text) => new SpeechSynthesisUtterance(text),
          setState,
          language,
        )
      : null;
    readerRef.current = reader;
    const updateVoices = () => {
      const selected = browserSupported
        ? selectBriefingVoice(synth.getVoices(), language)
        : null;
      voiceRef.current = selected;
      setVoice(selected);
      if (!selected && reader?.reading) stop();
    };
    updateVoices();
    const audio = serverEnabled
      ? createBriefingAudioReader(createWebAudioOutput(), setState, (index) => {
          const selected = voiceRef.current;
          if (!reader || !selected) return false;
          reader.listen(
            phrasesRef.current.map((phrase) => phrase.spoken),
            selected,
            index,
            t(language, briefingMessages, "fallback"),
          );
          return true;
        })
      : null;
    audioRef.current = audio;
    if (browserSupported) synth.addEventListener("voiceschanged", updateVoices);
    window.addEventListener("pagehide", stop);
    return () => {
      if (browserSupported)
        synth.removeEventListener("voiceschanged", updateVoices);
      window.removeEventListener("pagehide", stop);
      audio?.cancel();
      reader?.cancel();
      audioRef.current = null;
      readerRef.current = null;
    };
  }, [stop, language, serverEnabled]);

  const text = phrases.map((phrase) => phrase.visible).join("\n");
  const spoken = phrases.map((phrase) => phrase.spoken).join("\n");
  useEffect(() => {
    const reader = readerRef.current,
      audio = audioRef.current;
    if (
      (reader?.reading && reader.text !== spoken) ||
      (audio?.reading && audio.text !== text)
    ) {
      reader?.cancel();
      audio?.cancel();
      setState({
        current: null,
        status: t(language, briefingMessages, "updated"),
      });
    }
  }, [text, spoken, language]);

  function listen() {
    if (!phrases.length) return;
    phrasesRef.current = phrases;
    readerRef.current?.cancel();
    if (serverEnabled && navigator.onLine) {
      void audioRef.current?.listen(phrases);
    } else if (voice) {
      readerRef.current?.listen(
        phrases.map((phrase) => phrase.spoken),
        voice,
      );
    } else {
      setState({
        current: null,
        status: t(language, briefingMessages, "speechError"),
      });
    }
  }
  return {
    voice,
    canListen: serverEnabled || Boolean(voice),
    supported,
    ready,
    ...state,
    listen,
    stop,
  };
}
