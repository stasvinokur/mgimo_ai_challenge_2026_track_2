"use client";

import { useId, useMemo } from "react";
import type { TodayDto } from "@/application/today/get-today";
import { briefingMessages } from "@/ui/i18n/dictionaries/today";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader } from "@/ui/primitives/card";
import { openAssistant } from "@/ui/shell/assistant-entry";
import { buildTodayBriefingForms } from "./briefing";
import { useBriefingSpeech } from "./use-briefing-speech";
import { useTodayNow } from "./use-now";

export function TodayBriefingCard({
  data,
  serverSpeech = false,
}: {
  data: TodayDto;
  serverSpeech?: boolean;
}) {
  const language = useLanguage();
  const now = useTodayNow(data.asOf);
  const phrases = useMemo(
    () => buildTodayBriefingForms(data, now, language),
    [data, now, language],
  );
  const speech = useBriefingSpeech(phrases, serverSpeech);
  const heading = useId();
  const explanation = useId();
  return (
    <Card
      role="region"
      aria-labelledby={heading}
      className="min-w-0 gap-3 rounded-feature py-4"
      data-testid="today-briefing"
      data-briefing-ready={speech.ready}
    >
      <CardHeader className="px-4">
        <h2 id={heading} className="text-lg font-bold">
          {t(language, briefingMessages, "heading")}
        </h2>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        {phrases.length ? (
          <ol className="space-y-2 text-sm leading-relaxed">
            {phrases.map((phrase, index) => (
              <li
                key={phrase.visible}
                data-testid="briefing-phrase"
                data-spoken={phrase.spoken}
                data-speaking={speech.current === index ? "true" : undefined}
                className={`border-l-2 py-1 pl-3 ${speech.current === index ? "border-primary bg-accent font-semibold text-accent-foreground" : "border-transparent"}`}
              >
                {phrase.visible}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t(language, briefingMessages, "empty")}
          </p>
        )}
        <div className="today-briefing-controls flex flex-wrap gap-2">
          {(speech.canListen || language === "en") && phrases.length > 0 && (
            <Button
              type="button"
              variant="secondary"
              disabled={!speech.ready || !speech.canListen}
              aria-describedby={!speech.canListen ? explanation : undefined}
              onClick={speech.current === null ? speech.listen : speech.stop}
            >
              {t(
                language,
                briefingMessages,
                speech.current === null ? "listen" : "stop",
              )}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={!speech.ready}
            onClick={() => {
              if (speech.current !== null) speech.stop();
              openAssistant(t(language, briefingMessages, "question"));
            }}
          >
            {t(language, briefingMessages, "askMore")}
          </Button>
        </div>
        {!speech.canListen && (
          <p id={explanation} className="text-xs text-muted-foreground">
            {t(
              language,
              briefingMessages,
              speech.supported ? "noVoice" : "unsupported",
            )}
          </p>
        )}
        <p
          role="status"
          className={
            speech.status &&
            (speech.current === null ||
              speech.status.startsWith(
                t(language, briefingMessages, "fallback"),
              ))
              ? "text-xs text-muted-foreground"
              : "sr-only"
          }
          data-testid="briefing-status"
        >
          {speech.status}
        </p>
      </CardContent>
    </Card>
  );
}
