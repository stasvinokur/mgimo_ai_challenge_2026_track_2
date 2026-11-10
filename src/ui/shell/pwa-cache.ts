import { appPath, appStorageName } from "@/ui/shared/app-path.mjs";

export const PAGE_CACHE_PREFIX = `${appStorageName("pulse-pages")}-v1-`;
export const SESSION_STATE_CACHE = appStorageName("pulse-session-state-v1");
export const SAVED_AT_HEADER = "X-Pulse-Saved-At";
export const SESSION_HEADER = "X-Pulse-Session";
export const SESSION_EXPIRES_HEADER = "X-Pulse-Session-Expires-At";
export const MAX_OFFLINE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export type SnapshotReason = "offline" | "slow";
type RequestOrder = {
  worker: string;
  sequence: number;
  startedAt: number;
};
type PageRequest = { generation: number; order: RequestOrder };

function isRequestOrder(value: unknown): value is RequestOrder {
  return (
    typeof value === "object" &&
    value !== null &&
    "worker" in value &&
    typeof value.worker === "string" &&
    "sequence" in value &&
    Number.isSafeInteger(value.sequence) &&
    Number(value.sequence) > 0 &&
    "startedAt" in value &&
    typeof value.startedAt === "number" &&
    Number.isFinite(value.startedAt) &&
    value.startedAt >= 0
  );
}

function newerRequest(next: RequestOrder, previous: RequestOrder | null) {
  if (!previous) return true;
  return next.worker === previous.worker
    ? next.sequence > previous.sequence
    : next.startedAt > previous.startedAt;
}

export function isFreshSnapshot(response: Response, now = Date.now()) {
  const expiresAt = Date.parse(
    response.headers.get(SESSION_EXPIRES_HEADER) ?? "",
  );
  const savedAt = Date.parse(response.headers.get(SAVED_AT_HEADER) ?? "");
  return (
    Number.isFinite(expiresAt) &&
    Number.isFinite(savedAt) &&
    savedAt <= now &&
    now < expiresAt &&
    now - savedAt < MAX_OFFLINE_AGE_MS
  );
}

export function endsPageSession(response: Response, origin: string) {
  if (response.type === "opaqueredirect") return true;
  const target = response.redirected
    ? response.url
    : response.headers.get("Location");
  if (!target) return false;
  const url = new URL(target, origin);
  return url.origin === origin && url.pathname === appPath("/login");
}

export function isPageSnapshot(request: Request, origin: string) {
  const url = new URL(request.url);
  return (
    url.origin === origin &&
    request.method === "GET" &&
    !request.headers.has("Next-Action") &&
    !request.headers.has("RSC") &&
    !url.searchParams.has("_rsc") &&
    (request.mode === "navigate" ||
      Boolean(request.headers.get("Accept")?.includes("text/html"))) &&
    (url.pathname === appPath("/today") ||
      url.pathname === appPath("/schedule"))
  );
}

export function canSavePage(response: Response, origin: string) {
  return (
    response.status === 200 &&
    !response.redirected &&
    response.type !== "opaque" &&
    (!response.url || new URL(response.url).origin === origin) &&
    response.headers.get("Content-Type")?.includes("text/html") &&
    response.headers.get("X-Pulse-Cacheable") === "1" &&
    Date.parse(response.headers.get(SESSION_EXPIRES_HEADER) ?? "") >
      Date.now() &&
    /^[a-f0-9]{64}$/.test(response.headers.get(SESSION_HEADER) ?? "") &&
    !response.headers.has("Set-Cookie")
  );
}

// The durable denylist survives logout and worker restarts; generations fence in-flight work.
export class PwaPageCache {
  generation = 0;
  private session: string | null | undefined;
  private expiresAt: string | null = null;
  private retired = new Set<string>();
  private readonly worker = crypto.randomUUID();
  private sequence = 0;
  private sessionOrder: RequestOrder | null = null;
  private invalidatedAt: RequestOrder | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private unavailable = false;

  constructor(
    private readonly storage: CacheStorage,
    private readonly origin: string,
    private readonly buildId: string | null = null,
  ) {}

  startRequest(): PageRequest {
    return {
      generation: this.generation,
      order: {
        worker: this.worker,
        sequence: ++this.sequence,
        // Translate worker clocks to a shared timeline without awaiting storage.
        startedAt: performance.timeOrigin + performance.now(),
      },
    };
  }

  private pageCacheName(session: string) {
    return `${PAGE_CACHE_PREFIX}${this.buildId ? `${this.buildId}-` : ""}${session}`;
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      if (this.unavailable) throw new Error("PWA_SESSION_STATE_UNAVAILABLE");
      const locks = globalThis.navigator?.locks;
      if (!locks) throw new Error("PWA_SESSION_LOCK_UNAVAILABLE");
      // Page fallback and overlapping worker lifetimes share this origin-wide lock.
      return locks.request(appStorageName("pulse-pwa-session"), work);
    });
    this.queue = result.catch(() => {
      this.unavailable = true;
      console.warn("PWA_SESSION_STATE_UNAVAILABLE");
    });
    return result;
  }

  private stateURL() {
    return new URL(appPath("/__pwa_session_state"), this.origin).href;
  }

  private async persist() {
    const cache = await this.storage.open(SESSION_STATE_CACHE);
    await cache.put(
      this.stateURL(),
      Response.json({
        session: this.session ?? null,
        expiresAt: this.expiresAt,
        retired: [...this.retired],
        order: this.sessionOrder,
        invalidatedAt: this.invalidatedAt,
      }),
    );
  }

  private async initialize() {
    // Another worker or the uncontrolled-page fallback may have revoked a session.
    const cache = await this.storage.open(SESSION_STATE_CACHE);
    const saved = await cache.match(this.stateURL());
    if (saved) {
      const state: unknown = await saved.json();
      if (
        !state ||
        typeof state !== "object" ||
        !("session" in state) ||
        !(state.session === null || this.isSession(state.session)) ||
        !("expiresAt" in state) ||
        !(
          state.expiresAt === null ||
          (typeof state.expiresAt === "string" &&
            Number.isFinite(Date.parse(state.expiresAt)))
        ) ||
        !("retired" in state) ||
        !Array.isArray(state.retired) ||
        !state.retired.every((value: unknown) => this.isSession(value)) ||
        (state.session !== null && state.retired.includes(state.session)) ||
        ("order" in state &&
          state.order !== null &&
          !isRequestOrder(state.order)) ||
        ("invalidatedAt" in state &&
          state.invalidatedAt !== null &&
          !isRequestOrder(state.invalidatedAt))
      )
        throw new Error("PWA_SESSION_STATE_INVALID");
      this.session = state.session;
      this.expiresAt = state.expiresAt;
      this.retired = new Set(state.retired);
      this.sessionOrder =
        "order" in state ? (state.order as RequestOrder | null) : null;
      this.invalidatedAt =
        "invalidatedAt" in state
          ? (state.invalidatedAt as RequestOrder | null)
          : null;
      return;
    }
    const sessions = [
      ...new Set(
        (await this.storage.keys())
          .filter((name) => name.startsWith(PAGE_CACHE_PREFIX))
          .map((name) => name.slice(-64)),
      ),
    ];
    this.session =
      sessions.length === 1 && this.isSession(sessions[0]) ? sessions[0] : null;
    if (sessions.length > 1) {
      for (const session of sessions)
        if (this.isSession(session)) this.retired.add(session);
    }
    await this.persist();
    if (sessions.length > 1) await this.removePages();
  }

  private isSession(value: unknown): value is string {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  }

  private async removePages() {
    const names = await this.storage.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(PAGE_CACHE_PREFIX))
        .map((name) => this.storage.delete(name)),
    );
  }

  private async replaceSession(
    next: string | null,
    expiresAt: string | null = null,
  ) {
    if (this.session) this.retired.add(this.session);
    this.session = next;
    this.expiresAt = expiresAt;
    // Persist revocation before deleting HTML, so even interrupted deletion is safe on restart.
    await this.persist();
    await this.removePages();
  }

  private async expireSession() {
    if (
      this.session &&
      this.expiresAt &&
      Date.parse(this.expiresAt) <= Date.now()
    ) {
      this.generation++;
      this.fence(this.startRequest().order);
      await this.replaceSession(null);
    }
  }

  private fence(order: RequestOrder) {
    // An invalidation fences every response, including the active session's HTML.
    if (newerRequest(order, this.invalidatedAt)) this.invalidatedAt = order;
    if (
      this.sessionOrder &&
      newerRequest(this.sessionOrder, this.invalidatedAt)
    )
      this.invalidatedAt = this.sessionOrder;
  }

  clear() {
    this.generation++;
    const { order } = this.startRequest();
    return this.serial(async () => {
      await this.initialize();
      this.fence(order);
      await this.replaceSession(null);
    });
  }

  invalidate() {
    this.generation++;
    const { order } = this.startRequest();
    return this.serial(async () => {
      await this.initialize();
      await this.expireSession();
      this.fence(order);
      await this.persist();
      await this.removePages();
    });
  }

  activate() {
    return this.serial(async () => {
      await this.initialize();
      await this.expireSession();
      const names = await this.storage.keys();
      await Promise.all(
        names
          .filter(
            (name) =>
              name.startsWith(PAGE_CACHE_PREFIX) &&
              // Strip the separator and 64-character session fingerprint; legacy names have no build.
              name.slice(PAGE_CACHE_PREFIX.length, -65) !==
                (this.buildId ?? ""),
          )
          .map((name) => this.storage.delete(name)),
      );
    });
  }

  private async observeSession(response: Response, order: RequestOrder) {
    const session = response.headers.get(SESSION_HEADER);
    if (session !== "none" && !this.isSession(session)) return false;
    await this.initialize();
    await this.expireSession();
    const next = session === "none" ? null : session;
    if (next && this.retired.has(next)) return false;
    const expiresAt = response.headers.get(SESSION_EXPIRES_HEADER);
    if (next && (!expiresAt || !(Date.parse(expiresAt) > Date.now())))
      return false;
    const newer = newerRequest(order, this.sessionOrder);
    if (
      !newerRequest(order, this.invalidatedAt) ||
      (next !== this.session && !newer)
    ) {
      // Across workers a clock tie/reset cannot prove which user's HTML is current.
      if (next !== this.session && order.worker !== this.sessionOrder?.worker) {
        this.fence(this.startRequest().order);
        await this.persist();
        await this.removePages();
      }
      return false;
    }
    if (next !== this.session) {
      const changingSession = this.session !== null;
      this.sessionOrder = order;
      await this.replaceSession(next, next ? expiresAt : null);
      // Learning the first session must not discard its concurrent HTML snapshot.
      if (changingSession) this.generation++;
    } else {
      const extending =
        next && expiresAt && (!this.expiresAt || expiresAt > this.expiresAt);
      if (extending) this.expiresAt = expiresAt;
      // Even an initial "none" fences an older, still unseen student session.
      const assigning =
        newer &&
        (!next ||
          !this.sessionOrder ||
          !newerRequest(this.sessionOrder, this.invalidatedAt));
      // A prior invalidation may have persisted its fence but failed to delete HTML.
      if (assigning && next && this.invalidatedAt) await this.removePages();
      if (assigning) this.sessionOrder = order;
      if (extending || assigning) await this.persist();
    }
    return true;
  }

  observe(response: Response, started: PageRequest) {
    return this.serial(async () => {
      if (started.generation === this.generation)
        await this.observeSession(response, started.order);
    });
  }

  save(request: Request, response: Response, started: PageRequest) {
    return this.serial(async () => {
      if (started.generation !== this.generation) return;
      if (!(await this.observeSession(response, started.order))) return;
      if (
        !isPageSnapshot(request, this.origin) ||
        !canSavePage(response, this.origin)
      )
        return;
      const session = response.headers.get(SESSION_HEADER);
      if (!session || session !== this.session) return;
      const headers = new Headers(response.headers);
      headers.set(SAVED_AT_HEADER, new Date().toISOString());
      // Cache Storage is explicitly permitted for private, no-store HTML by D-28.
      const cache = await this.storage.open(this.pageCacheName(session));
      await cache.put(
        new URL(new URL(request.url).pathname, this.origin).href,
        new Response(response.body, { status: 200, headers }),
      );
    });
  }

  read(pathname: string) {
    if (this.unavailable) return Promise.resolve(undefined);
    return this.serial(async () => {
      await this.initialize();
      await this.expireSession();
      if (!this.session) return undefined;
      if (
        this.invalidatedAt &&
        (!this.sessionOrder ||
          !newerRequest(this.sessionOrder, this.invalidatedAt))
      )
        return undefined;
      const name = this.pageCacheName(this.session);
      if (!(await this.storage.keys()).includes(name)) return undefined;
      const cache = await this.storage.open(name);
      const response = await cache.match(new URL(pathname, this.origin).href);
      if (response && !isFreshSnapshot(response)) {
        this.generation++;
        this.fence(this.startRequest().order);
        await this.replaceSession(null);
        return undefined;
      }
      return response;
    });
  }
}

export async function offlineSnapshot(
  response: Response,
  reason: SnapshotReason = "offline",
) {
  if (!isFreshSnapshot(response)) return undefined;
  const savedAt = response.headers.get(SAVED_AT_HEADER);
  if (!savedAt || !Number.isFinite(Date.parse(savedAt))) return undefined;
  const body = await response.text();
  if (!isFreshSnapshot(response)) return undefined;
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  // Keep the original nonce and CSP together; only add inert metadata for the banner.
  return new Response(
    body.replace(
      /<html\b/,
      `<html data-pwa-saved-at="${new Date(savedAt).toISOString()}" data-pwa-snapshot-reason="${reason}"`,
    ),
    { status: 200, headers },
  );
}
