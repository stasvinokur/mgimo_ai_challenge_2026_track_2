import { gradesMessages } from "@/ui/i18n/dictionaries/grades";
import { getLanguage } from "@/ui/i18n/server";
import { t } from "@/ui/i18n/translate";
import { Skeleton } from "@/ui/primitives/skeleton";

export default async function Loading() {
  const language = await getLanguage();
  return (
    <div aria-busy="true" className="section-page">
      <p role="status">{t(language, gradesMessages, "loadingGrades")}</p>
      <Skeleton className="h-12 w-2/3" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
