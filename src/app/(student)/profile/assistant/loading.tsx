import { assistantMessages } from "@/ui/i18n/dictionaries/assistant";
import { getLanguage } from "@/ui/i18n/server";
import { t } from "@/ui/i18n/translate";
import { Skeleton } from "@/ui/primitives/skeleton";

export default async function Loading() {
  const language = await getLanguage();
  return (
    <section
      className="section-page"
      aria-busy="true"
      aria-labelledby="journal-loading"
    >
      <h1 id="journal-loading">
        {t(language, assistantMessages, "journalTitle")}
      </h1>
      <p role="status" className="text-sm text-muted-foreground">
        {t(language, assistantMessages, "loadingEntries")}
      </p>
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-64 w-full rounded-feature" />
      <Skeleton className="h-64 w-full rounded-feature" />
    </section>
  );
}
