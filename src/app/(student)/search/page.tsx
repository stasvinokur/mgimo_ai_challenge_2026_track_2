import type { Metadata } from "next";
import { requireStudent } from "@/app/_lib/get-actor";
import { mapPageError } from "@/app/_lib/map-errors";
import type { SearchDto } from "@/application/search/dto";
import type { SearchValidationCode } from "@/application/search/schemas";
import { ValidationError } from "@/application/shared/errors";
import { search } from "@/composition/container";
import { searchMessages } from "@/ui/i18n/dictionaries/search";
import { getLanguage } from "@/ui/i18n/server";
import { t } from "@/ui/i18n/translate";
import { SearchView } from "@/ui/search/search-view";

export async function generateMetadata(): Promise<Metadata> {
  await requireStudent();
  return { title: t(await getLanguage(), searchMessages, "title") };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireStudent();
  const language = await getLanguage();
  const { q } = await searchParams;
  const query = typeof q === "string" ? q : "";
  let result: SearchDto | undefined;
  let validation: SearchValidationCode | undefined;
  if (
    q !== undefined &&
    (typeof q !== "string" || q.trim() !== "" || /\p{Cc}/u.test(q))
  ) {
    try {
      result = await search.execute(actor, { q });
    } catch (error) {
      if (error instanceof ValidationError)
        validation =
          error.fieldErrors.q?.[0] === "controlCharacters"
            ? "controlCharacters"
            : "queryLength";
      else mapPageError(error);
    }
  }
  return (
    <SearchView
      key={query}
      query={query}
      result={result}
      validation={validation}
      language={language}
    />
  );
}
