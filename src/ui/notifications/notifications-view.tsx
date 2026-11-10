"use client";

import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarClock,
  CalendarSync,
  Check,
  FileCheck,
  Newspaper,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { NotificationDto } from "@/application/notifications/ports";
import type { NotificationsFeedDto } from "@/application/notifications/use-cases";
import { notificationsMessages } from "@/ui/i18n/dictionaries/notifications";
import { formatDate, formatNumber } from "@/ui/i18n/format";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/primitives/card";
import { EmptyState } from "@/ui/primitives/empty-state";
import { StatusBadge } from "@/ui/primitives/status-badge";
import { notificationActionLabel } from "./action-label";
import {
  type NotificationActionError,
  notificationErrorMessage,
} from "./error-message";

const categories = {
  change: { icon: CalendarSync },
  deadline: { icon: CalendarClock },
  request: { icon: FileCheck },
  news: { icon: Newspaper },
  alert: { icon: AlertTriangle },
};
const dateOptions = {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
} as const;
type ActionResult =
  | { ok: true; link?: string | null }
  | { ok: false; error: NotificationActionError };

export function NotificationsView({
  feed,
  read,
  readAll,
}: {
  feed: NotificationsFeedDto;
  read(input: { id: string; open?: boolean }): Promise<ActionResult>;
  readAll(): Promise<ActionResult>;
}) {
  const router = useRouter();
  const language = useLanguage();
  const text = (key: keyof typeof notificationsMessages) =>
    t(language, notificationsMessages, key);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [category, setCategory] = useState<NotificationDto["kind"] | "all">(
    "all",
  );
  const [expanded, setExpanded] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<NotificationActionError | null>(null);
  const selected = (items: NotificationDto[]) =>
    items.filter((item) => category === "all" || item.kind === category);
  const high = selected(feed.high);
  const normal = selected(feed.normal);
  const digest = selected(feed.digest);
  const unread = [...feed.high, ...feed.normal, ...feed.digest].some(
    (item) => !item.readAt,
  );

  function run(action: () => Promise<ActionResult>) {
    start(async () => {
      setError(null);
      try {
        const result = await action();
        if (!result.ok) setError(result.error);
        else if (result.link) router.push(result.link);
        else router.refresh();
      } catch {
        setError({ code: "INTERNAL_ERROR" });
      }
    });
  }
  function cards(items: NotificationDto[]) {
    return (
      <ul className="space-y-4">
        {items.map((item) => {
          const { icon: Icon } = categories[item.kind];
          return (
            <li key={item.id} data-notification-id={item.id}>
              <Card className={!item.readAt ? "border-primary" : undefined}>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <Icon className="size-4" aria-hidden="true" />
                      {text(item.kind)}
                    </span>
                    <time dateTime={item.createdAt}>
                      {formatDate(language, item.createdAt, dateOptions)}{" "}
                      {text("moscowTime")}
                    </time>
                  </div>
                  <CardTitle>
                    <h3
                      className="text-lg leading-snug"
                      lang={language === "en" ? "ru" : undefined}
                    >
                      {item.title}
                    </h3>
                  </CardTitle>
                  <div className="flex flex-wrap gap-2">
                    {item.priority === "high" && (
                      <StatusBadge tone="warning">
                        {text("attention")}
                      </StatusBadge>
                    )}
                    {item.readAt ? (
                      <span className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Check className="size-4" aria-hidden="true" />
                        {text("read")}
                      </span>
                    ) : (
                      <StatusBadge tone="info">{text("unread")}</StatusBadge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {language === "en" && (
                    <p className="text-sm text-muted-foreground">
                      {text("russianContent")}
                    </p>
                  )}
                  <p
                    className="whitespace-pre-wrap text-sm"
                    lang={language === "en" ? "ru" : undefined}
                  >
                    {item.body}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {item.link && (
                      <Button
                        asChild
                        variant="outline"
                        disabled={pending || !ready}
                      >
                        <Link
                          href={item.link}
                          prefetch={false}
                          aria-disabled={pending || !ready}
                          onClick={(event) => {
                            event.preventDefault();
                            if (!pending && ready)
                              run(() => read({ id: item.id, open: true }));
                          }}
                        >
                          {notificationActionLabel(item.link, language)}
                          <ArrowRight aria-hidden="true" />
                        </Link>
                      </Button>
                    )}
                    {!item.readAt && (
                      <Button
                        variant="ghost"
                        disabled={pending || !ready}
                        onClick={() => run(() => read({ id: item.id }))}
                      >
                        {text("read")}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <div
      className="section-page [&_[data-slot=button]]:h-auto [&_[data-slot=button]]:max-w-full [&_[data-slot=button]]:whitespace-normal"
      data-notifications-ready={ready}
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow">{text("eyebrow")}</p>
          <h1>{text("title")}</h1>
          <p className="page-lead">{text("lead")}</p>
        </div>
        <Button
          variant="outline"
          disabled={pending || !ready || !unread}
          onClick={() => run(readAll)}
        >
          {text("readAll")}
        </Button>
      </div>
      <fieldset
        aria-label={text("categories")}
        disabled={!ready}
        className="flex flex-wrap gap-2"
      >
        <Button
          variant={category === "all" ? "secondary" : "ghost"}
          aria-pressed={category === "all"}
          onClick={() => setCategory("all")}
        >
          {text("all")}
        </Button>
        {(Object.keys(categories) as NotificationDto["kind"][]).map((kind) => (
          <Button
            key={kind}
            variant={category === kind ? "secondary" : "ghost"}
            aria-pressed={category === kind}
            onClick={() => setCategory(kind)}
          >
            {text(kind)}
          </Button>
        ))}
      </fieldset>
      {error && (
        <div role="alert" className="space-y-3 rounded-xl border p-4">
          <p>{notificationErrorMessage(language, error)}</p>
          <Button
            variant="outline"
            onClick={() => {
              setError(null);
              router.refresh();
            }}
          >
            {text("retry")}
          </Button>
        </div>
      )}
      {high.length > 0 && (
        <section
          aria-labelledby="notifications-important"
          className="space-y-4"
        >
          <h2 id="notifications-important">{text("attention")}</h2>
          {cards(high)}
        </section>
      )}
      {normal.length > 0 && (
        <section aria-labelledby="notifications-feed" className="space-y-4">
          <h2 id="notifications-feed">{text("feed")}</h2>
          {cards(normal)}
        </section>
      )}
      {digest.length > 0 && (
        <section
          className="space-y-4 rounded-xl border bg-secondary p-4"
          aria-label={text("quiet")}
        >
          <Button
            variant="ghost"
            aria-expanded={expanded}
            aria-controls="notifications-digest"
            onClick={() => setExpanded(!expanded)}
          >
            {t(language, notificationsMessages, "digest", {
              count: formatNumber(language, digest.length),
              action: text(expanded ? "collapse" : "expand"),
            })}
          </Button>
          <p className="text-sm text-muted-foreground">
            {text("quietDescription")}
          </p>
          <div id="notifications-digest" hidden={!expanded}>
            {cards(digest)}
          </div>
        </section>
      )}
      {high.length + normal.length + digest.length === 0 && (
        <EmptyState
          icon={Bell}
          title={text(category === "all" ? "empty" : "emptyCategory")}
          description={text("emptyDescription")}
          action={
            category === "all" ? (
              <Button asChild variant="outline">
                <Link href="/schedule">{text("schedule")}</Link>
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setCategory("all")}>
                {text("showAll")}
              </Button>
            )
          }
        />
      )}
      {(category === "all" || category === "news") && (
        <section
          aria-labelledby="notifications-announcements"
          className="space-y-4"
        >
          <div>
            <h2 id="notifications-announcements">{text("announcements")}</h2>
            <p className="text-sm text-muted-foreground">
              {text("announcementsDescription")}
            </p>
          </div>
          {feed.announcements.length ? (
            <ul className="space-y-4">
              {feed.announcements.map((item) => (
                <li key={item.id}>
                  <Card>
                    <CardHeader>
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Newspaper className="size-4" aria-hidden="true" />
                        {text("news")}
                      </p>
                      <CardTitle>
                        <h3
                          className="text-lg"
                          lang={language === "en" ? "ru" : undefined}
                        >
                          {item.title}
                        </h3>
                      </CardTitle>
                      <time
                        className="text-sm text-muted-foreground"
                        dateTime={item.publishedAt}
                      >
                        {formatDate(language, item.publishedAt, dateOptions)}{" "}
                        {text("moscowTime")}
                      </time>
                    </CardHeader>
                    <CardContent>
                      {language === "en" && (
                        <p className="mb-3 text-sm text-muted-foreground">
                          {text("russianAnnouncement")}
                        </p>
                      )}
                      <p
                        className="whitespace-pre-wrap text-sm"
                        lang={language === "en" ? "ru" : undefined}
                      >
                        {item.body}
                      </p>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {text("announcementsEmpty")}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
