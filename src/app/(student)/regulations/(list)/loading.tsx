import { regulationsMessages } from "@/ui/i18n/dictionaries/regulations";
import { getLanguage } from "@/ui/i18n/server";
import { t } from "@/ui/i18n/translate";
import { Skeleton } from "@/ui/primitives/skeleton";

export default async function Loading() {
  const language = await getLanguage();
  return (
    <section
      aria-busy="true"
      aria-label={t(language, regulationsMessages, "loadingLabel")}
      className="mx-auto w-full max-w-3xl space-y-4"
    >
      <p role="status" className="sr-only">
        {t(language, regulationsMessages, "loading")}
      </p>
      <Skeleton className="h-10 w-3/4" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </section>
  );
}
