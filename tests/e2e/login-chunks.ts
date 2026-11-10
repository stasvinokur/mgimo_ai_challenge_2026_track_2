export function loginScriptUrl(value: string, origin: string): string | null {
  try {
    const url = new URL(value.replaceAll("&amp;", "&"), origin);
    return url.origin === new URL(origin).origin &&
      url.pathname.startsWith("/_next/static/") &&
      url.pathname.endsWith(".js")
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function loginScriptsFromHtml(html: string, origin: string): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(
    /<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["'][^>]*>/gi,
  )) {
    const url = loginScriptUrl(match[1] ?? "", origin);
    if (url) urls.add(url);
  }
  return [...urls];
}
