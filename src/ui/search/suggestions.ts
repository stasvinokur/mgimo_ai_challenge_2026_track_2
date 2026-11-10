import type { SearchDto } from "@/application/search/dto";
import { isInternalSearchHref } from "@/application/search/links";
import { appPath } from "@/ui/shared/app-path.mjs";

export type SuggestionState =
  | { status: "idle" | "pending" | "error" }
  | { status: "ready"; result: SearchDto };

export function createSuggestions(
  publish: (state: SuggestionState) => void,
  fetcher: typeof fetch = (...args) => fetch(...args),
) {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  function cancel() {
    generation++;
    clearTimeout(timer);
    controller?.abort();
  }

  return {
    cancel,
    search(input: string) {
      cancel();
      const q = input.trim();
      if (q.length < 2 || q.length > 80) {
        publish({ status: "idle" });
        return;
      }
      const current = generation;
      const abort = new AbortController();
      controller = abort;
      publish({ status: "pending" });
      timer = setTimeout(async () => {
        try {
          const response = await fetcher(
            appPath(`/api/search/suggest?${new URLSearchParams({ q })}`),
            {
              signal: abort.signal,
              cache: "no-store",
              credentials: "same-origin",
            },
          );
          // Consume even error and superseded responses so connections can finish.
          const body = await response.text();
          if (current !== generation) return;
          if (!response.ok) throw new Error("SEARCH_SUGGEST_UNAVAILABLE");
          const result = JSON.parse(body) as SearchDto;
          if (
            !Array.isArray(result.groups) ||
            result.groups.some(
              (group) =>
                !Array.isArray(group.items) ||
                group.items.some((item) => !isInternalSearchHref(item.href)),
            )
          )
            throw new Error("SEARCH_SUGGEST_INVALID_LINK");
          publish({ status: "ready", result });
        } catch {
          if (current === generation) publish({ status: "error" });
        }
      }, 200);
    },
  };
}

export function isPaletteShortcut(event: {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
}) {
  return (
    event.code === "KeyK" &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    !event.isComposing
  );
}
