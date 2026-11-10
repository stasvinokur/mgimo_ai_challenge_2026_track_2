import { Fragment } from "react";
import { splitMarkedText, splitSearchText } from "@/application/search/dto";

export function Highlight({
  text,
  query,
  marked = false,
}: {
  text: string;
  query: string;
  marked?: boolean;
}) {
  const parts = marked ? splitMarkedText(text) : [{ text, matched: false }];
  let offset = 0;
  return parts
    .flatMap((part) =>
      part.matched ? [part] : splitSearchText(part.text, query),
    )
    .map((part) => {
      const key = offset;
      offset += part.text.length + 1;
      return part.matched ? (
        <mark key={key} className="rounded bg-accent text-accent-foreground">
          {part.text}
        </mark>
      ) : (
        <Fragment key={key}>{part.text}</Fragment>
      );
    });
}
