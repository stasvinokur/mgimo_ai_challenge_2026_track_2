import { createHash, randomBytes } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { identity, system } from "@/composition/container";
import { appPath } from "@/ui/shared/app-path.mjs";

export async function proxy(request: NextRequest) {
  const nonce = randomBytes(16).toString("base64");
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const protectedPage =
    /^\/(today|schedule|grades|requests|notifications|profile|staff|teacher|attend)(\/|$)/.test(
      request.nextUrl.pathname,
    );
  const token = request.cookies.get(identity.sessionCookie.name)?.value;
  let session: Awaited<ReturnType<typeof identity.getCurrentActor.execute>> =
    null;
  let checked = false;
  if (token) {
    try {
      session = await identity.getCurrentActor.execute(token);
      checked = true;
    } catch {
      // Server layouts still enforce authorization if storage is unavailable.
      system.logger.error("session_lookup_failed", {
        code: "SESSION_UNAVAILABLE",
      });
    }
  }
  let response: NextResponse;
  if (protectedPage && (!token || (checked && !session))) {
    const url = new URL(appPath("/login"), request.url);
    url.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    response = NextResponse.redirect(url);
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }
  if (session?.renewed && token)
    response.cookies.set(
      identity.sessionCookie.name,
      token,
      identity.sessionCookie.options(session.expiresAt),
    );
  // The public certificate check sets its own stricter CSP (no scripts at all).
  if (!/^\/verify\/[^/]+\/?$/.test(request.nextUrl.pathname))
    response.headers.set("Content-Security-Policy", policy);
  response.headers.set("Cache-Control", "private, no-store");
  // Fetch hides Set-Cookie from workers; explicitly exclude cookie renewal here.
  response.headers.set(
    "X-Pulse-Session",
    session?.actor.kind === "student" && token
      ? createHash("sha256").update(`pulse-pwa:${token}`).digest("hex")
      : "none",
  );
  if (session?.actor.kind === "student")
    response.headers.set("X-Pulse-Session-Expires-At", session.expiresAt);
  if (
    session?.actor.kind === "student" &&
    !session.renewed &&
    request.method === "GET" &&
    request.headers.get("Accept")?.includes("text/html") &&
    !request.headers.has("RSC") &&
    !request.nextUrl.searchParams.has("_rsc") &&
    !request.headers.has("Next-Action") &&
    /^\/(today|schedule)$/.test(request.nextUrl.pathname)
  )
    response.headers.set("X-Pulse-Cacheable", "1");
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static/|_next/image$|sw\\.js$|manifest\\.webmanifest$|offline\\.(?:html|css|js)$|favicon\\.svg$|pulse\\.svg$|icons/(?:icon-192\\.png|icon-512\\.png|icon-maskable-512\\.png|apple-touch-icon\\.png)$).*)",
  ],
};
