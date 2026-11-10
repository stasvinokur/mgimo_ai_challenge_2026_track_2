import type { Metadata } from "next";
import Link from "next/link";
import { requireStudent } from "@/app/_lib/get-actor";
import { onboardingMessages } from "@/ui/i18n/dictionaries/onboarding";
import { getLanguage } from "@/ui/i18n/server";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent } from "@/ui/primitives/card";

export async function generateMetadata(): Promise<Metadata> {
  await requireStudent();
  return {
    title: t(await getLanguage(), onboardingMessages, "installPageTitle"),
  };
}

export default async function Page() {
  await requireStudent();
  const language = await getLanguage();
  return (
    <div className="section-page [overflow-wrap:normal] [word-break:normal]">
      <h1>{t(language, onboardingMessages, "install")}</h1>
      <Card>
        <CardContent className="space-y-4">
          <p>{t(language, onboardingMessages, "installIntroduction")}</p>
          <p className="text-sm text-muted-foreground">
            {t(language, onboardingMessages, "installHelp")}
          </p>
          <Button asChild variant="outline">
            <Link href="/today">
              {t(language, onboardingMessages, "backToSteps")}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
