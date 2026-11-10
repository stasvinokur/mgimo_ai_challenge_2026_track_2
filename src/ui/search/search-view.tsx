import { Search } from "lucide-react";
import Link from "next/link";
import type { SearchDto } from "@/application/search/dto";
import type { SearchValidationCode } from "@/application/search/schemas";
import { searchMessages } from "@/ui/i18n/dictionaries/search";
import { formatNumber } from "@/ui/i18n/format";
import type { Language } from "@/ui/i18n/language";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitives/card";
import { EmptyState } from "@/ui/primitives/empty-state";
import { appPath } from "@/ui/shared/app-path.mjs";
import { AskAssistant } from "./ask-assistant";
import { formatSearchContext, formatSearchTitle } from "./format-result";
import { Highlight } from "./highlight";
import { SearchForm } from "./search-form";

export function SearchView({
  query,
  result,
  validation,
  language = "ru",
}: {
  query: string;
  result?: SearchDto;
  validation?: SearchValidationCode;
  language?: Language;
}) {
  const complete = result?.groups.every((group) => group.status === "ok");
  const empty =
    complete && result?.groups.every((group) => group.items.length === 0);
  const retry = `/search?${new URLSearchParams({ q: query })}`;
  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-6 [overflow-wrap:normal] [word-break:normal]">
      <header>
        <p className="eyebrow">{t(language, searchMessages, "cabinet")}</p>
        <h1 className="text-2xl font-semibold">
          {t(language, searchMessages, "title")}
        </h1>
        <p className="page-lead">{t(language, searchMessages, "lead")}</p>
      </header>
      <search aria-label={t(language, searchMessages, "pageSearch")}>
        <SearchForm key={query} className="space-y-2">
          <label htmlFor="cabinet-query" className="text-sm font-medium">
            {t(language, searchMessages, "query")}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="cabinet-query"
              name="q"
              type="search"
              defaultValue={query}
              aria-invalid={!!validation}
              aria-describedby={
                validation ? "cabinet-search-error" : "cabinet-search-hint"
              }
              className="min-h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
            />
            <Button type="submit">
              <Search aria-hidden="true" />
              {t(language, searchMessages, "find")}
            </Button>
          </div>
          <p id="cabinet-search-hint" className="text-sm text-muted-foreground">
            {t(language, searchMessages, "hint")}
          </p>
          {validation && (
            <p
              id="cabinet-search-error"
              role="alert"
              className="text-sm text-destructive"
            >
              {t(language, searchMessages, validation)}
            </p>
          )}
        </SearchForm>
      </search>
      {!result && !validation && (
        <Card variant="hero">
          <CardHeader>
            <CardTitle>
              <h2>{t(language, searchMessages, "startTitle")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p>{t(language, searchMessages, "startDescription")}</p>
          </CardContent>
        </Card>
      )}
      {empty && (
        <EmptyState
          icon={Search}
          title={t(language, searchMessages, "emptyTitle")}
          description={t(language, searchMessages, "emptyDescription")}
          action={<AskAssistant />}
        />
      )}
      {result && !empty && (
        <section
          className="space-y-4"
          aria-label={t(language, searchMessages, "results")}
        >
          {result.groups.map((group) => (
            <section key={group.id} aria-labelledby={`search-${group.id}`}>
              <Card>
                <CardHeader>
                  <CardTitle>
                    <h2 id={`search-${group.id}`}>
                      {t(language, searchMessages, group.id)}
                    </h2>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {group.status !== "ok" && (
                    <div role="status" className="space-y-2 text-sm">
                      <p>
                        {t(
                          language,
                          searchMessages,
                          group.status === "partial" ? "partial" : "groupError",
                        )}
                      </p>
                      <Button asChild variant="outline">
                        <a href={appPath(retry)}>
                          {t(language, searchMessages, "retry")}
                        </a>
                      </Button>
                    </div>
                  )}
                  {group.items.length > 0 && (
                    <ul className="space-y-2">
                      {group.items.map((item) => (
                        <li key={item.id}>
                          <Link
                            href={item.href}
                            className="block min-h-11 min-w-0 space-y-1 rounded-md p-2 [overflow-wrap:normal] [word-break:normal] hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            <span className="block font-medium text-primary underline underline-offset-4">
                              <Highlight
                                text={formatSearchTitle(language, item.title)}
                                query={query}
                              />
                            </span>
                            <span className="block text-sm text-muted-foreground">
                              <Highlight
                                text={formatSearchContext(
                                  language,
                                  item.context,
                                )}
                                query={query}
                                marked={item.markedContext}
                              />
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  {group.items.length === 0 && group.status === "ok" && (
                    <p className="text-sm text-muted-foreground">
                      {t(language, searchMessages, "noMatches")}
                    </p>
                  )}
                  {group.more > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t(language, searchMessages, "more", {
                        count: formatNumber(language, group.more),
                      })}
                    </p>
                  )}
                </CardContent>
              </Card>
            </section>
          ))}
        </section>
      )}
    </div>
  );
}
