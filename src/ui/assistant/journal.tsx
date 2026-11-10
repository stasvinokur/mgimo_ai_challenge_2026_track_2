import { History } from "lucide-react";
import Link from "next/link";
import {
  type AssistantJournalEntryDto,
  assistantJournalLimit,
} from "@/application/assistant/get-my-journal";
import { assistantMessages } from "@/ui/i18n/dictionaries/assistant";
import { formatDate } from "@/ui/i18n/format";
import type { Language } from "@/ui/i18n/language";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader } from "@/ui/primitives/card";
import { EmptyState } from "@/ui/primitives/empty-state";
import { JournalStart } from "./journal-start";

export function AssistantJournal({
  entries,
  language = "ru",
}: {
  entries: AssistantJournalEntryDto[];
  language?: Language;
}) {
  const tr = (
    key: keyof typeof assistantMessages,
    params?: Record<string, string | number>,
  ) => t(language, assistantMessages, key, params);
  if (entries.length === 0)
    return (
      <EmptyState
        icon={History}
        title={tr("emptyTitle")}
        description={tr("emptyDescription")}
        action={<JournalStart />}
      />
    );
  return (
    <section className="min-w-0 space-y-4" aria-labelledby="journal-entries">
      <h2 id="journal-entries" className="text-lg font-bold">
        {tr("latestEntries")}
      </h2>
      {entries.length === assistantJournalLimit && (
        <p className="text-sm text-muted-foreground">
          {tr("journalLimit", { count: assistantJournalLimit })}
        </p>
      )}
      <ol className="min-w-0 space-y-4">
        {entries.map((entry, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: The read-only server snapshot has no row state or public storage ids.
          <li key={`${entry.at}-${index}`} className="min-w-0">
            <Card className="min-w-0 rounded-feature">
              <CardHeader>
                <time
                  dateTime={entry.at}
                  className="text-sm text-muted-foreground"
                >
                  {formatDate(language, entry.at, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  {tr("moscow")}
                </time>
              </CardHeader>
              <CardContent className="min-w-0 space-y-4">
                <dl className="min-w-0 space-y-4">
                  <div className="min-w-0">
                    <dt className="mb-2 text-xs font-bold text-muted-foreground">
                      {tr(entry.questionLabel)}
                    </dt>
                    <dd
                      className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-secondary p-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
                      // biome-ignore lint/a11y/noNoninteractiveTabindex: Long questions need keyboard scrolling.
                      tabIndex={0}
                    >
                      {entry.questionCode
                        ? tr(entry.questionCode)
                        : entry.question}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold text-muted-foreground">
                      {tr("aiAction")}
                    </dt>
                    <dd className="mt-1 font-semibold">
                      {tr(entry.assistantAction)}
                    </dd>
                  </div>
                  {entry.studentDecision && (
                    <div className="rounded-xl border border-primary/30 bg-accent p-3 text-accent-foreground">
                      <dt className="text-xs font-bold">
                        {tr("yourDecision")}
                      </dt>
                      <dd className="mt-1 space-y-2">
                        <p className="font-semibold">
                          {tr(entry.studentDecision.code)}
                        </p>
                        {entry.studentDecision.href && (
                          <Button asChild variant="outline">
                            <Link href={entry.studentDecision.href}>
                              {tr("myRequests")}
                            </Link>
                          </Button>
                        )}
                      </dd>
                    </div>
                  )}
                </dl>
                {entry.sources.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold text-muted-foreground">
                      {tr("sources")}
                    </h3>
                    <ul className="mt-1 space-y-1 text-sm">
                      {entry.sources.map((source) => (
                        <li key={source.href}>
                          <Link
                            className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
                            href={source.href}
                          >
                            {source.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>
    </section>
  );
}
