import type { Metadata } from "next";
import { demoAccounts } from "@/application/identity/demo-accounts";
import { safeNextPath } from "@/application/identity/schemas";
import { identity } from "@/composition/container";
import { loginMessages } from "@/ui/i18n/dictionaries/login";
import { shellMessages } from "@/ui/i18n/dictionaries/shell";
import { LanguageSelect } from "@/ui/i18n/language-select";
import { getLanguage } from "@/ui/i18n/server";
import { t } from "@/ui/i18n/translate";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/ui/primitives/card";
import { Brand } from "@/ui/shell/brand";
import { ThemeToggle } from "@/ui/shell/theme-toggle";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const language = await getLanguage();
  return { title: t(language, loginMessages, "pageTitle") };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const next = safeNextPath((await searchParams).next);
  const language = await getLanguage();
  return (
    <main className="standalone-state flex min-w-0 flex-col gap-6 [overflow-wrap:normal] [word-break:normal]">
      <div className="flex items-center justify-between gap-4">
        <Brand href="/login" />
        <ThemeToggle />
      </div>
      <LanguageSelect />
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>{t(language, loginMessages, "title")}</h1>
          </CardTitle>
          <CardDescription>
            {t(language, loginMessages, "description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm
            next={next}
            accounts={identity.demoLoginHints ? demoAccounts : []}
          />
        </CardContent>
      </Card>
      <p className="rounded-xl border border-border bg-secondary p-4 text-sm text-muted-foreground">
        {t(language, shellMessages, "competitionConcept")}
      </p>
    </main>
  );
}
