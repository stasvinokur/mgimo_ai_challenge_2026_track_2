import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { appPath, withoutBasePath } from "@/ui/shared/app-path.mjs";

export function internalRegulationUrl(url: string): string | undefined {
  if (
    /^(?:\/(?!\/)|#)/.test(url) &&
    !Array.from(url).some(
      (char) =>
        char === "\\" || char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127,
    )
  ) {
    if (url.startsWith("#")) return url;
    const origin = "https://pulse.invalid";
    const parsed = new URL(appPath(url), origin);
    if (parsed.origin === origin && withoutBasePath(parsed.pathname) !== null)
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }
  return undefined;
}

export function RegulationMarkdown({ children }: { children: string }) {
  return (
    <div className="space-y-3 break-words text-sm leading-relaxed [&_a]:inline-block [&_a]:min-h-11 [&_a]:py-2 [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-ring [&_code]:break-all [&_li]:ml-4 [&_ul]:list-disc [&_ol]:list-decimal [&_pre]:overflow-x-auto">
      <ReactMarkdown
        skipHtml
        urlTransform={internalRegulationUrl}
        components={{
          img: () => null,
          a: ({ href, children: label }) =>
            href ? <a href={href}>{label}</a> : <span>{label}</span>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function RegulationExcerpt({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/\[\[\[([\s\S]*?)\]\]\]/g)) {
    parts.push(
      text.slice(cursor, match.index),
      <mark
        key={match.index}
        className="rounded bg-accent text-accent-foreground"
      >
        {match[1]}
      </mark>,
    );
    cursor = match.index + match[0].length;
  }
  parts.push(text.slice(cursor));
  return parts;
}
