import type { Metadata } from "next";
import { requireStudent } from "@/app/_lib/get-actor";
import { mapPageError } from "@/app/_lib/map-errors";
import { parsePageQuery } from "@/application/regulations/schemas";
import type { RegulationResultDto } from "@/application/regulations/use-cases";
import { ValidationError } from "@/application/shared/errors";
import { regulations } from "@/composition/container";
import { regulationsMessages } from "@/ui/i18n/dictionaries/regulations";
import { getLanguage } from "@/ui/i18n/server";
import { t } from "@/ui/i18n/translate";
import { RegulationsCatalog } from "@/ui/regulations/catalog";

export async function generateMetadata(): Promise<Metadata> {
  await requireStudent();
  return { title: t(await getLanguage(), regulationsMessages, "catalogTitle") };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireStudent();
  const language = await getLanguage();
  try {
    const { q } = parsePageQuery(await searchParams);
    const documents = await regulations.list.execute(actor);
    let results: RegulationResultDto[] | undefined;
    let validation: "INVALID_REGULATION_QUERY" | undefined;
    if (q !== undefined) {
      try {
        results = await regulations.search.execute(actor, { query: q });
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
        validation = "INVALID_REGULATION_QUERY";
      }
    }
    return (
      <RegulationsCatalog
        key={q ?? ""}
        language={language}
        documents={documents}
        query={q}
        results={results}
        validation={validation}
      />
    );
  } catch (error) {
    mapPageError(error);
  }
}
