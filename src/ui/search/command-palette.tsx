"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { type MouseEvent, useEffect, useId, useRef, useState } from "react";
import type { SearchResultDto } from "@/application/search/dto";
import { searchMessages } from "@/ui/i18n/dictionaries/search";
import { formatNumber } from "@/ui/i18n/format";
import { useLanguage } from "@/ui/i18n/language-provider";
import { t } from "@/ui/i18n/translate";
import { Button } from "@/ui/primitives/button";
import { Skeleton } from "@/ui/primitives/skeleton";
import { cn } from "@/ui/primitives/utils";
import { openAssistant } from "@/ui/shell/assistant-entry";
import { formatSearchContext, formatSearchTitle } from "./format-result";
import { Highlight } from "./highlight";
import {
  createSuggestions,
  isPaletteShortcut,
  type SuggestionState,
} from "./suggestions";

const actionDefinitions = [
  {
    id: "new-request",
    key: "newRequest",
    href: "/requests/new?type=enrollment",
  },
  { id: "week", key: "week", href: "/schedule?view=week" },
  { id: "what-if", key: "whatIf", href: "/grades" },
  { id: "regulations", key: "regulations", href: "/regulations" },
  { id: "notifications", key: "notifications", href: "/notifications" },
] as const;

type Option = {
  id: string;
  title: string;
  href?: string;
  context?: string;
  markedContext?: boolean;
};

export function CommandPalette() {
  const language = useLanguage();
  const actions: Option[] = actionDefinitions.map(({ id, key, href }) => ({
    id,
    title: t(language, searchMessages, key),
    href,
  }));
  function resultOption(item: SearchResultDto, group: string): Option {
    return {
      ...item,
      id: `${group}:${item.id}`,
      title: formatSearchTitle(language, item.title),
      context: formatSearchContext(language, item.context),
    };
  }
  const router = useRouter();
  const id = useId();
  const trigger = useRef<HTMLAnchorElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const question = useRef<string | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [enhanced, setEnhanced] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string>();
  const [state, setState] = useState<SuggestionState>({ status: "idle" });
  const [announcement, setAnnouncement] = useState("");
  const [client] = useState(() => createSuggestions(setState));

  function changeOpen(value: boolean) {
    client.cancel();
    setOpen(value);
    setQuery("");
    setActive(undefined);
    setState({ status: "idle" });
    setAnnouncement("");
  }

  useEffect(() => () => client.cancel(), [client]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event) || event.defaultPrevented || event.repeat)
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target !== input.current &&
        (target.isContentEditable ||
          target.closest(
            "input, textarea, select, [role='textbox'], [role='combobox']",
          ))
      )
        return;
      event.preventDefault();
      if (open) input.current?.focus();
      else setOpen(true);
    };
    document.addEventListener("keydown", listener);
    setEnhanced(true);
    return () => document.removeEventListener("keydown", listener);
  }, [open]);

  const result =
    state.status === "ready" && state.result.query === query.trim()
      ? state.result
      : undefined;
  const groups = result?.groups ?? [];
  const empty = result?.groups.every(
    (group) => group.status === "ok" && group.items.length === 0,
  );
  const options: Option[] = [
    ...groups.flatMap((group) =>
      group.items.map((item) => resultOption(item, group.id)),
    ),
    ...(empty ? [] : actions),
    {
      id: "assistant",
      title: query.trim()
        ? t(language, searchMessages, "assistantQuery", { query: query.trim() })
        : t(language, searchMessages, "assistant"),
    },
  ];
  const selected = options.find((option) => option.id === active);
  const optionId = (key: string) => `${id}-option-${encodeURIComponent(key)}`;

  useEffect(() => {
    if (state.status === "ready") {
      const count = state.result.groups.reduce(
        (sum, group) => sum + group.items.length,
        0,
      );
      const partial = state.result.groups.some(
        (group) => group.status !== "ok",
      );
      setAnnouncement(
        t(language, searchMessages, "found", {
          count: formatNumber(language, count),
        }) + (partial ? t(language, searchMessages, "sourcesUnavailable") : ""),
      );
    } else if (state.status === "error")
      setAnnouncement(t(language, searchMessages, "suggestionsError"));
    else if (state.status === "idle") setAnnouncement("");
  }, [state, language]);

  useEffect(() => {
    if (selected)
      document
        .getElementById(optionId(selected.id))
        ?.scrollIntoView({ block: "nearest" });
  });

  function choose(option: Option) {
    if (option.id === "assistant") question.current = query.trim();
    changeOpen(false);
    if (option.href) router.push(option.href);
  }

  function renderOption(option: Option) {
    const props = {
      tabIndex: -1,
      id: optionId(option.id),
      role: "option" as const,
      "aria-selected": active === option.id,
      className: cn(
        "block min-h-11 w-full min-w-0 cursor-pointer overflow-hidden rounded-md px-3 py-2 text-left [overflow-wrap:normal] hover:bg-accent",
        active === option.id &&
          "bg-accent text-accent-foreground outline-2 -outline-offset-2 outline-ring",
      ),
      onPointerMove: () => setActive(option.id),
      onMouseDown: (event: MouseEvent<HTMLElement>) => event.preventDefault(),
      onClick: (event: MouseEvent<HTMLElement>) => {
        if (
          option.href &&
          (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        )
          return;
        event.preventDefault();
        choose(option);
      },
    };
    const content = (
      <>
        <span className="block truncate font-medium">
          <Highlight text={option.title} query={query.trim()} />
        </span>
        {option.context && (
          <span className="block text-sm text-muted-foreground">
            <Highlight
              text={option.context}
              query={query.trim()}
              marked={option.markedContext}
            />
          </span>
        )}
      </>
    );
    return option.href ? (
      <Link key={option.id} href={option.href} prefetch={false} {...props}>
        {content}
      </Link>
    ) : (
      <button key={option.id} type="button" {...props}>
        {content}
      </button>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Link
        ref={trigger}
        href="/search?q="
        prefetch={false}
        data-palette-ready={enhanced ? "true" : undefined}
        aria-haspopup={enhanced ? "dialog" : undefined}
        aria-expanded={enhanced ? open : undefined}
        aria-keyshortcuts={enhanced ? "Meta+K Control+K" : undefined}
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-md px-2 text-sm [overflow-wrap:normal] hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            return;
          event.preventDefault();
          changeOpen(true);
        }}
      >
        <Search size={21} aria-hidden="true" />
        <span className="sr-only lg:not-sr-only">
          {t(language, searchMessages, "title")}
        </span>
        <kbd className="hidden rounded border border-border px-1 text-xs text-muted-foreground lg:inline">
          ⌘K / Ctrl+K
        </kbd>
      </Link>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className="fixed inset-0 z-50 flex h-dvh min-w-0 flex-col gap-4 bg-background p-4 text-foreground shadow-lg [overflow-wrap:normal] [word-break:normal] sm:inset-auto sm:top-[10vh] sm:left-1/2 sm:h-auto sm:max-h-[80dvh] sm:w-full sm:max-w-2xl sm:-translate-x-1/2 sm:rounded-xl sm:border sm:border-border sm:p-6"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
            if (question.current !== undefined) {
              const pending = question.current;
              question.current = undefined;
              openAssistant(pending || undefined);
            }
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <Dialog.Title className="text-xl font-semibold">
                {t(language, searchMessages, "paletteTitle")}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                {t(language, searchMessages, "paletteDescription")}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon">
                <X aria-hidden="true" />
                <span className="sr-only">
                  {t(language, searchMessages, "close")}
                </span>
              </Button>
            </Dialog.Close>
          </div>
          <div className="space-y-2">
            <label htmlFor={`${id}-query`} className="text-sm font-medium">
              {t(language, searchMessages, "paletteQuery")}
            </label>
            <input
              ref={input}
              id={`${id}-query`}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={true}
              aria-controls={`${id}-list`}
              aria-activedescendant={
                selected ? optionId(selected.id) : undefined
              }
              aria-describedby={`${id}-hint`}
              autoComplete="off"
              maxLength={80}
              value={query}
              className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base focus-visible:outline-2 focus-visible:outline-ring"
              onChange={(event) => {
                const value = event.target.value;
                setQuery(value);
                setActive(undefined);
                client.search(value);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const index = options.findIndex(
                    (option) => option.id === active,
                  );
                  const next =
                    event.key === "ArrowDown"
                      ? (index + 1) % options.length
                      : index < 0
                        ? options.length - 1
                        : (index - 1 + options.length) % options.length;
                  setActive(options[next]?.id);
                } else if (event.key === "Enter" && selected) {
                  event.preventDefault();
                  choose(selected);
                }
              }}
            />
            <p id={`${id}-hint`} className="text-xs text-muted-foreground">
              {t(language, searchMessages, "paletteHint")}
            </p>
          </div>
          <p role="status" aria-atomic="true" className="sr-only">
            {announcement}
          </p>
          {state.status === "pending" && (
            <div aria-hidden="true" className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {t(language, searchMessages, "searching")}
              </p>
              <Skeleton className="h-8 w-full" />
            </div>
          )}
          {(state.status === "error" ||
            groups.some((group) => group.status !== "ok")) && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <p>{t(language, searchMessages, "suggestionsPartial")}</p>
              <Button variant="outline" onClick={() => client.search(query)}>
                {t(language, searchMessages, "retry")}
              </Button>
            </div>
          )}
          <span id={`${id}-options-label`} className="sr-only">
            {t(language, searchMessages, "suggestions")}
          </span>
          <div
            id={`${id}-list`}
            role="listbox"
            aria-labelledby={`${id}-options-label`}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain"
          >
            {groups
              .filter((group) => group.items.length > 0)
              .map((group) => (
                <fieldset
                  className="min-w-0"
                  key={group.id}
                  aria-labelledby={`${id}-${group.id}`}
                >
                  <legend
                    id={`${id}-${group.id}`}
                    className="px-3 py-1 text-sm font-semibold text-muted-foreground"
                  >
                    {t(language, searchMessages, group.id)}
                  </legend>
                  {group.items.map((item) =>
                    renderOption(resultOption(item, group.id)),
                  )}
                  {group.more > 0 && (
                    <p className="px-3 text-xs text-muted-foreground">
                      {t(language, searchMessages, "paletteMore", {
                        count: formatNumber(language, group.more),
                      })}
                    </p>
                  )}
                </fieldset>
              ))}
            {empty && (
              <p className="px-3 text-sm text-muted-foreground">
                {t(language, searchMessages, "paletteEmpty")}
              </p>
            )}
            {!empty && (
              <fieldset className="min-w-0" aria-labelledby={`${id}-actions`}>
                <legend
                  id={`${id}-actions`}
                  className="px-3 py-1 text-sm font-semibold text-muted-foreground"
                >
                  {t(language, searchMessages, "actions")}
                </legend>
                {actions.map(renderOption)}
              </fieldset>
            )}
            {renderOption(options[options.length - 1] as Option)}
          </div>
          <Link
            href={`/search?${new URLSearchParams({ q: query.trim() })}`}
            prefetch={false}
            onClick={() => changeOpen(false)}
            className="min-h-11 rounded-md p-2 text-sm text-primary underline underline-offset-4 [overflow-wrap:normal] focus-visible:outline-2 focus-visible:outline-ring"
          >
            {t(language, searchMessages, "openPage")}
          </Link>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
