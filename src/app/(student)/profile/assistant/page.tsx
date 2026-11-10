import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { requireStudent } from "@/app/_lib/get-actor";
import { mapPageError } from "@/app/_lib/map-errors";
import { assistant, identity } from "@/composition/container";
import { AssistantJournal } from "@/ui/assistant/journal";
import { assistantMessages } from "@/ui/i18n/dictionaries/assistant";
import { getLanguage } from "@/ui/i18n/server";
import { t } from "@/ui/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  await requireStudent();
  const language = await getLanguage();
  return { title: t(language, assistantMessages, "journalTitle") };
}

export default async function Page() {
  const actor = await requireStudent();
  const language = await getLanguage();
  const tr = (key: keyof typeof assistantMessages) =>
    t(language, assistantMessages, key);
  const entries = await assistant.getMyJournal
    .execute(actor, (await cookies()).get(identity.sessionCookie.name)?.value)
    .catch(mapPageError);
  return (
    <div className="section-page">
      <Link
        className="inline-flex min-h-11 items-center text-sm text-primary underline"
        href="/profile"
      >
        {tr("backProfile")}
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{tr("transparency")}</p>
          <h1>{tr("journalTitle")}</h1>
          <p className="page-lead">{tr("journalLead")}</p>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{tr("journalNote")}</p>
      <AssistantJournal entries={entries} language={language} />
    </div>
  );
}
