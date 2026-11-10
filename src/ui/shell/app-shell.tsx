"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { shellMessages } from "@/ui/i18n/dictionaries/shell";
import type { Language } from "@/ui/i18n/language";
import { LanguageProvider, useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { cn } from "@/ui/primitives/utils";
import type { RequestProfileAction } from "@/ui/requests/profile-fields";
import { CommandPalette } from "@/ui/search/command-palette";
import { AssistantSheet } from "@/ui/shell/assistant-sheet";
import { Brand } from "@/ui/shell/brand";
import { type Audience, navigation } from "@/ui/shell/navigation";
import { PwaInstall } from "@/ui/shell/pwa-install";
import { PwaStatus } from "@/ui/shell/pwa-status";
import { ThemeToggle } from "@/ui/shell/theme-toggle";

type AppShellProps = {
  audience: Audience;
  children: ReactNode;
  unreadNotifications?: number | null;
  requestProfileAction?: RequestProfileAction;
};

const navigationKeys = {
  "/today": "today",
  "/schedule": "schedule",
  "/grades": "grades",
  "/requests": "requests",
  "/profile": "profile",
  "/notifications": "notifications",
  "/regulations": "regulations",
  "/staff/requests": "studentRequests",
  "/staff/pickup": "pickup",
  "/teacher/grades": "gradebook",
  "/teacher": "lessons",
} as const;

export function AppShell(props: AppShellProps) {
  const language = useLanguage();
  return (
    <LanguageProvider language={props.audience === "student" ? language : "ru"}>
      <ShellContent {...props} deviceLanguage={language} />
    </LanguageProvider>
  );
}

function ShellContent({
  audience,
  children,
  unreadNotifications = 0,
  requestProfileAction,
  deviceLanguage,
}: AppShellProps & { deviceLanguage: Language }) {
  const language = useLanguage();
  const pathname = usePathname();
  const items = navigation
    .filter((item) => item.audience === audience)
    .map((item) => ({
      ...item,
      label: t(language, shellMessages, navigationKeys[item.href]),
    }));
  const primary = items.filter((item) => item.placement === "primary");
  const current = items.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  const home = primary[0]?.href ?? "/today";
  const label =
    audience === "student"
      ? t(language, shellMessages, "studentAccount")
      : audience === "teacher"
        ? t(language, shellMessages, "teacherAccount")
        : t(language, shellMessages, "staffAccount");
  const notificationLabel =
    unreadNotifications === null
      ? t(language, shellMessages, "notifications")
      : t(language, shellMessages, "unreadNotifications", {
          count: unreadNotifications,
        });
  const unreadBadge = unreadNotifications !== null && (
    <span
      aria-hidden="true"
      data-unread-count={unreadNotifications}
      className="unread-badge"
    >
      {unreadNotifications > 99 ? "99+" : unreadNotifications}
    </span>
  );
  function links(mobile = false) {
    return (mobile ? primary : items).map(
      ({ href, label: text, icon: Icon }) => {
        const active = current?.href === href;
        return (
          <Link
            key={href}
            href={href}
            className={cn("nav-link", active && "nav-link-active")}
            style={
              mobile && primary.length === 1
                ? {
                    flex: "0 0 auto",
                    paddingInline: "calc(var(--spacing) * 5)",
                  }
                : undefined
            }
            aria-current={active ? "page" : undefined}
          >
            <Icon size={21} strokeWidth={1.7} aria-hidden="true" />
            <span>{text}</span>
            {href === "/notifications" && unreadNotifications !== null && (
              <>
                {" "}
                <span
                  data-unread-count={unreadNotifications}
                  className="unread-badge"
                >
                  {unreadNotifications > 99 ? "99+" : unreadNotifications}
                </span>
                <span className="sr-only">
                  {t(language, shellMessages, "unreadSuffix")}
                </span>
              </>
            )}
          </Link>
        );
      },
    );
  }
  return (
    <div className="app-shell" data-audience={audience} lang={language}>
      <a href="#main-content" className="skip-link">
        {t(language, shellMessages, "skipContent")}
      </a>
      <aside
        className="app-sidebar [overflow-wrap:normal] [word-break:normal]"
        aria-label={label}
      >
        <Brand href={home} />
        <p className="sidebar-label">{label}</p>
        <nav aria-label={t(language, shellMessages, "navigation")}>
          {links()}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <p>{t(language, shellMessages, "competitionConcept")}</p>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="app-header [overflow-wrap:normal] [word-break:normal]">
          <div className="mobile-brand">
            <Brand href={home} />
          </div>
          <div className="breadcrumb">
            <span>{label}</span>
            <ChevronRight size={14} aria-hidden="true" />
            <span>
              {pathname === "/search"
                ? t(language, shellMessages, "search")
                : (current?.label ?? t(language, shellMessages, "page"))}
            </span>
          </div>
          <div className="header-actions">
            {audience === "student" && <CommandPalette />}
            <ThemeToggle />
            {items
              .filter((item) => item.placement === "header")
              .map(({ href, label: text, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  aria-label={
                    href === "/notifications" ? notificationLabel : text
                  }
                  aria-current={current?.href === href ? "page" : undefined}
                  className={cn(
                    "header-icon relative",
                    current?.href === href && "nav-link-active",
                  )}
                >
                  <Icon size={21} aria-hidden="true" />
                  {href === "/notifications" && unreadBadge}
                </Link>
              ))}
          </div>
        </header>
        <main id="main-content" className="page-content" tabIndex={-1}>
          {audience !== "student" && deviceLanguage === "en" && (
            <p
              lang="en"
              className="mb-4 rounded-xl border border-border bg-secondary p-4 text-sm"
            >
              {t("en", shellMessages, "russianInterface")}
            </p>
          )}
          {audience === "student" && <PwaStatus />}
          {audience === "student" && <PwaInstall />}
          {children}
          {audience === "student" && (
            <nav
              aria-label={t(language, shellMessages, "useful")}
              className="mt-6 md:hidden [overflow-wrap:normal] [word-break:normal]"
            >
              {items
                .filter((item) => item.placement === "secondary")
                .map(({ href, label: text, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    className="nav-link"
                    aria-current={current?.href === href ? "page" : undefined}
                  >
                    <Icon size={21} aria-hidden="true" />
                    {text}
                  </Link>
                ))}
            </nav>
          )}
        </main>
      </div>
      <nav
        className="mobile-navigation [overflow-wrap:normal] [word-break:normal]"
        aria-label={t(language, shellMessages, "navigation")}
      >
        {links(true)}
      </nav>
      {audience === "student" && (
        <AssistantSheet requestProfileAction={requestProfileAction} />
      )}
    </div>
  );
}
