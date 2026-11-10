export function isInternalSearchHref(href: unknown): href is string {
  return (
    typeof href === "string" &&
    href.startsWith("/") &&
    !href.startsWith("//") &&
    !/[\\\p{Cc}]/u.test(href)
  );
}
