export function isAssistantOriginAllowed(
  request: Request,
  appOrigin?: string,
): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  try {
    let trusted: URL;
    if (appOrigin) trusted = new URL(appOrigin);
    else {
      const host =
        request.headers.get("x-forwarded-host")?.split(",").at(-1)?.trim() ||
        request.headers.get("host");
      if (!host || !/^(?:\[[a-f\d:.]+\]|[a-z\d.-]+)(?::\d+)?$/i.test(host))
        return false;
      const forwarded = request.headers
        .get("x-forwarded-proto")
        ?.split(",")
        .at(-1)
        ?.trim();
      if (forwarded && forwarded !== "http" && forwarded !== "https")
        return false;
      trusted = new URL(
        `${forwarded ? `${forwarded}:` : new URL(request.url).protocol}//${host}`,
      );
    }
    if (trusted.protocol !== "https:" && trusted.protocol !== "http:")
      return false;
    return origin === trusted.origin;
  } catch {
    return false;
  }
}
