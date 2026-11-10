export function isCanonicalPushEndpoint(endpoint: string): boolean {
  if (!/^https:\/\/[a-z0-9.-]+\//.test(endpoint)) return false;
  try {
    const url = new URL(endpoint);
    return (
      endpoint === url.href &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function isTrustedPushEndpoint(endpoint: string): boolean {
  if (!isCanonicalPushEndpoint(endpoint)) return false;
  const host = new URL(endpoint).hostname;
  return (
    host === "fcm.googleapis.com" ||
    host === "updates.push.services.mozilla.com" ||
    /^[a-z0-9-]+\.push\.services\.mozilla\.com$/.test(host) ||
    /^[a-z0-9-]+\.push\.apple\.com$/.test(host) ||
    /^[a-z0-9-]+\.notify\.windows\.com$/.test(host)
  );
}
