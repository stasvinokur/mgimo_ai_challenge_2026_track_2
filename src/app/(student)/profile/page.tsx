import type { Metadata } from "next";
import Link from "next/link";
import { requireStudent } from "@/app/_lib/get-actor";
import { mapPageError } from "@/app/_lib/map-errors";
import { LogoutButton } from "@/app/(auth)/logout-button";
import { student } from "@/composition/container";
import { profileMessages } from "@/ui/i18n/dictionaries/profile";
import { formatNumber } from "@/ui/i18n/format";
import { getLanguage } from "@/ui/i18n/server";
import { t } from "@/ui/i18n/translate";
import { PasskeyCard } from "@/ui/identity/passkey-card";
import { PushCard } from "@/ui/notifications/push-card";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitives/card";
import { SettingsCard } from "@/ui/settings/settings-card";

export async function generateMetadata(): Promise<Metadata> {
  await requireStudent();
  return { title: t(await getLanguage(), profileMessages, "title") };
}

export default async function Page() {
  const actor = await requireStudent();
  const language = await getLanguage();
  const profile = await student.getMyProfile.execute(actor).catch(mapPageError);
  const fields = [
    ["fullName", profile.fullName],
    ["faculty", profile.faculty],
    ["program", profile.program],
    ["course", formatNumber(language, profile.course)],
    ["group", profile.group],
    ["recordBookNo", profile.recordBookNo],
    ["scholarship", t(language, profileMessages, profile.scholarship)],
  ] as const;
  return (
    <div className="section-page [overflow-wrap:normal] [word-break:normal]">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t(language, profileMessages, "cabinet")}</p>
          <h1>{t(language, profileMessages, "title")}</h1>
          <p className="page-lead">{t(language, profileMessages, "lead")}</p>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t(language, profileMessages, "studentDetails")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid min-w-0 gap-4 sm:grid-cols-2">
            {fields.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-sm text-muted-foreground">
                  {t(language, profileMessages, label)}
                </dt>
                <dd className="m-0 font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <PushCard />
      <Button asChild variant="outline" className="w-fit">
        <Link href="/profile/assistant">
          {t(language, profileMessages, "assistantJournal")}
        </Link>
      </Button>
      <PasskeyCard />
      <p className="text-sm text-muted-foreground">
        {t(language, profileMessages, "themeHint")}
      </p>
      <SettingsCard />
      <LogoutButton language={language} />
    </div>
  );
}
