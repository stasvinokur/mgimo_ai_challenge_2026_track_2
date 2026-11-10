import Link from "next/link";
import type { RegulationDocumentDto } from "@/application/regulations/use-cases";
import { regulationsMessages } from "@/ui/i18n/dictionaries/regulations";
import type { Language } from "@/ui/i18n/language";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitives/card";
import { RegulationMarkdown } from "./markdown";
import { CopySectionLink, RegulationHashFocus } from "./section-actions";

export function RegulationDocument({
  document,
  language,
}: {
  document: RegulationDocumentDto;
  language: Language;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 [overflow-wrap:normal] [word-break:normal]">
      <RegulationHashFocus key={document.slug} />
      <Button asChild variant="ghost">
        <Link href="/regulations">
          {t(language, regulationsMessages, "back")}
        </Link>
      </Button>
      <header className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">
          {t(language, regulationsMessages, "catalogTitle")}
        </p>
        <h1 className="break-words text-2xl font-semibold" lang="ru">
          {document.title}
        </h1>
        {language === "en" && (
          <p className="text-sm text-muted-foreground">
            {t(language, regulationsMessages, "russianContent")}
          </p>
        )}
        <div lang="ru">
          <RegulationMarkdown>{document.introduction}</RegulationMarkdown>
        </div>
      </header>
      <nav
        aria-label={t(language, regulationsMessages, "sections")}
        className="flex flex-wrap gap-2"
      >
        {document.sections.map((section) => (
          <Button asChild key={section.anchor} variant="outline" size="sm">
            <a href={`#${section.anchor}`}>
              {t(language, regulationsMessages, "goToSection", {
                section: section.section,
              })}
            </a>
          </Button>
        ))}
      </nav>
      {document.sections.map((section) => (
        <section
          key={section.anchor}
          id={section.anchor}
          tabIndex={-1}
          aria-labelledby={`${section.anchor}-title`}
          className="scroll-mt-24 rounded-xl outline-offset-4 data-[highlighted=true]:bg-accent data-[highlighted=true]:ring-2 data-[highlighted=true]:ring-primary focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Card className="bg-transparent">
            <CardHeader>
              <CardTitle>
                <h2
                  id={`${section.anchor}-title`}
                  className="break-words"
                  lang="ru"
                >
                  § {section.section}. {section.title}
                </h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div lang="ru">
                <RegulationMarkdown>{section.body}</RegulationMarkdown>
              </div>
              <CopySectionLink href={section.href} section={section.section} />
            </CardContent>
          </Card>
        </section>
      ))}
    </div>
  );
}
