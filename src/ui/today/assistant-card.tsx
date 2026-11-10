"use client";

import { ArrowUp, Sparkles } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { todayMessages } from "@/ui/i18n/dictionaries/today";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader } from "@/ui/primitives/card";
import { openAssistant } from "@/ui/shell/assistant-entry";

export function TodayAssistantCard() {
  const language = useLanguage();
  const quickQuestions = [
    "quickNext",
    "quickChanges",
    "quickDebts",
    "quickCertificate",
  ] as const;
  const questions = quickQuestions.map((key) =>
    t(language, todayMessages, key),
  );
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [question, setQuestion] = useState("");
  const inputId = useId();
  return (
    <Card
      className="hidden min-w-0 gap-4 rounded-feature border-0 bg-[var(--hero)] py-4 text-[var(--hero-ink)] lg:flex"
      data-testid="today-assistant"
      data-today-assistant-ready={ready}
    >
      <CardHeader className="px-4">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Sparkles className="size-5 shrink-0" aria-hidden="true" />
          {t(language, todayMessages, "assistant")}
        </h2>
      </CardHeader>
      <CardContent className="space-y-4 px-4">
        <div className="flex flex-wrap gap-2">
          {questions.map((text) => (
            <Button
              key={text}
              variant="outline"
              disabled={!ready}
              className="h-auto max-w-full rounded-full whitespace-normal text-left text-foreground"
              onClick={() => openAssistant(text)}
            >
              {text}
            </Button>
          ))}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const text = question.trim();
            if (text) openAssistant(text);
          }}
        >
          <div className="min-w-0 flex-1">
            <label htmlFor={inputId} className="mb-1 block text-sm font-medium">
              {t(language, todayMessages, "question")}
            </label>
            <input
              id={inputId}
              disabled={!ready}
              maxLength={2000}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              className="min-h-11 w-full min-w-0 rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              placeholder={t(language, todayMessages, "questionPlaceholder")}
            />
          </div>
          <Button
            type="submit"
            size="icon"
            aria-label={t(language, todayMessages, "ask")}
            disabled={!ready || !question.trim()}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
        </form>
        <p className="text-sm">{t(language, todayMessages, "assistantHint")}</p>
      </CardContent>
    </Card>
  );
}
