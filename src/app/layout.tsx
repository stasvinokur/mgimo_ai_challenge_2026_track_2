import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import { getConceptMessage } from "@/application/shared/get-concept";
import { shellMessages } from "@/ui/i18n/dictionaries/shell";
import { LANGUAGE_COOKIE, parseLanguage } from "@/ui/i18n/language";
import { t } from "@/ui/i18n/translate";
import {
  accessibilityClasses,
  parseAccessibilitySettings,
} from "@/ui/settings/accessibility";
import { appPath } from "@/ui/shared/app-path.mjs";
import { ConceptNotice } from "@/ui/shell/concept-notice";
import { Providers } from "@/ui/shell/providers";
import { PwaRegistration } from "@/ui/shell/pwa-registration";
import { themeScript } from "@/ui/shell/theme";
import "@fontsource/golos-text/400.css";
import "@fontsource/golos-text/500.css";
import "@fontsource/golos-text/600.css";
import "@fontsource/golos-text/700.css";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const language = parseLanguage((await cookies()).get(LANGUAGE_COOKIE)?.value);
  const name = t(language, shellMessages, "brandName");
  return {
    title: {
      default: t(language, shellMessages, "metadataTitle"),
      template: `%s · ${name}`,
    },
    description: t(language, shellMessages, "metadataDescription"),
    icons: {
      icon: appPath("/favicon.svg"),
      apple: appPath("/icons/apple-touch-icon.png"),
    },
    manifest: appPath("/manifest.webmanifest"),
    applicationName: name,
    appleWebApp: { capable: true, title: name, statusBarStyle: "default" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f2" },
    { media: "(prefers-color-scheme: dark)", color: "#131c19" },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [requestHeaders, cookieStore] = await Promise.all([
    headers(),
    cookies(),
  ]);
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  const settings = parseAccessibilitySettings(
    (name) => cookieStore.get(name)?.value,
  );
  const language = parseLanguage(cookieStore.get(LANGUAGE_COOKIE)?.value);
  const concept = getConceptMessage();
  return (
    <html
      lang={language}
      className={accessibilityClasses(settings)}
      suppressHydrationWarning
    >
      <body>
        <Providers nonce={nonce} settings={settings} language={language}>
          <script nonce={nonce}>{themeScript}</script>
          <PwaRegistration />
          <div className="app-root">
            {children}
            <ConceptNotice>
              {t(language, shellMessages, concept.notice)}
            </ConceptNotice>
          </div>
        </Providers>
      </body>
    </html>
  );
}
