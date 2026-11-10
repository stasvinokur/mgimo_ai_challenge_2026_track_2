import type { Metadata } from "next";
import { requireStudent } from "@/app/_lib/get-actor";
import { mapPageError } from "@/app/_lib/map-errors";
import { parseListInput } from "@/application/regulations/schemas";
import { regulations } from "@/composition/container";
import { regulationsMessages } from "@/ui/i18n/dictionaries/regulations";
import { getLanguage } from "@/ui/i18n/server";
import { t } from "@/ui/i18n/translate";
import { RegulationDocument } from "@/ui/regulations/document";

export async function generateMetadata(): Promise<Metadata> {
  await requireStudent();
  return {
    title: t(await getLanguage(), regulationsMessages, "documentTitle"),
  };
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireStudent();
  const language = await getLanguage();
  try {
    parseListInput(await searchParams);
    const document = await regulations.get.execute(actor, await params);
    return <RegulationDocument document={document} language={language} />;
  } catch (error) {
    mapPageError(error);
  }
}
