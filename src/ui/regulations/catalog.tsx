import { BookOpen, Search } from "lucide-react";
import Link from "next/link";
import type {
  RegulationResultDto,
  RegulationSummary,
} from "@/application/regulations/use-cases";
import { regulationsMessages } from "@/ui/i18n/dictionaries/regulations";
import type { Language } from "@/ui/i18n/language";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitives/card";
import { EmptyState } from "@/ui/primitives/empty-state";
import { appPath } from "@/ui/shared/app-path.mjs";
import { RegulationExcerpt } from "./markdown";

export function RegulationsCatalog({
  documents,
  language,
  query,
  results,
  validation,
}: {
  documents: RegulationSummary[];
  language: Language;
  query?: string;
  results?: RegulationResultDto[];
  validation?: "INVALID_REGULATION_QUERY";
}) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 [overflow-wrap:normal] [word-break:normal]">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">
          {t(language, regulationsMessages, "catalogTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t(language, regulationsMessages, "introduction")}
        </p>
        {language === "en" && (
          <p className="text-sm text-muted-foreground">
            {t(language, regulationsMessages, "russianContent")}
          </p>
        )}
      </header>
      <search>
        <form
          action={appPath("/regulations")}
          method="get"
          className="space-y-2"
        >
          <label htmlFor="regulation-query" className="text-sm font-medium">
            {t(language, regulationsMessages, "searchLabel")}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="regulation-query"
              name="q"
              type="search"
              defaultValue={query}
              maxLength={200}
              required
              placeholder={t(
                language,
                regulationsMessages,
                "searchPlaceholder",
              )}
              aria-invalid={!!validation}
              aria-describedby={
                validation
                  ? "regulation-search-error"
                  : "regulation-search-hint"
              }
              className="min-h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
            />
            <Button type="submit">
              <Search aria-hidden="true" />
              {t(language, regulationsMessages, "search")}
            </Button>
          </div>
          <p
            id="regulation-search-hint"
            className="text-sm text-muted-foreground"
          >
            {t(language, regulationsMessages, "searchHint")}
          </p>
          {validation && (
            <p
              role="alert"
              id="regulation-search-error"
              className="text-sm text-destructive"
            >
              {t(language, regulationsMessages, validation)}
            </p>
          )}
        </form>
      </search>
      {results && (
        <section aria-labelledby="search-results-title" className="space-y-3">
          <h2 id="search-results-title" className="text-lg font-semibold">
            {t(language, regulationsMessages, "results")}
          </h2>
          {results.length ? (
            <ul className="space-y-3">
              {results.map((result) => (
                <li key={result.href}>
                  <Card>
                    <CardContent className="space-y-2">
                      <p className="text-sm text-muted-foreground" lang="ru">
                        {result.documentTitle} · § {result.section}
                      </p>
                      <h3>
                        <Link
                          href={result.href}
                          lang="ru"
                          className="inline-flex min-h-11 items-center break-words font-semibold text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          {result.title}
                        </Link>
                      </h3>
                      <p
                        className="break-words text-sm leading-relaxed"
                        lang="ru"
                      >
                        <RegulationExcerpt text={result.excerpt} />
                      </p>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Search}
              title={t(language, regulationsMessages, "noMatches")}
              description={t(language, regulationsMessages, "noMatchesHint")}
              action={
                <Button asChild>
                  <Link href="/requests/new?type=question">
                    {t(language, regulationsMessages, "question")}
                  </Link>
                </Button>
              }
            />
          )}
        </section>
      )}
      <section aria-labelledby="regulation-list-title" className="space-y-3">
        <h2 id="regulation-list-title" className="text-lg font-semibold">
          {t(language, regulationsMessages, "all")}
        </h2>
        {documents.length ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {documents.map((document) => (
              <li key={document.slug}>
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle>
                      <h3>
                        <Link
                          href={`/regulations/${document.slug}`}
                          lang="ru"
                          className="inline-flex min-h-11 items-center break-words text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          {document.title}
                        </Link>
                      </h3>
                    </CardTitle>
                  </CardHeader>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={BookOpen}
            title={t(language, regulationsMessages, "empty")}
            description={t(language, regulationsMessages, "emptyHint")}
            action={
              <Button asChild>
                <Link href="/requests/new?type=question">
                  {t(language, regulationsMessages, "question")}
                </Link>
              </Button>
            }
          />
        )}
      </section>
    </div>
  );
}
