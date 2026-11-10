import type { PulseDto } from "@/application/notifications/ports";

export const PULSE_INTERVAL_MS = 10_000;
const MAX_RETRY_INTERVAL_MS = 60_000;

export class PulseHttpError extends Error {
  constructor(readonly status: number) {
    super("Пульс недоступен.");
  }
}

export function startPulsePolling(options: {
  initial: PulseDto | null;
  visible(): boolean;
  subscribe(listener: () => void): () => void;
  load(signal: AbortSignal): Promise<PulseDto>;
  changed(
    pulse: PulseDto,
    previous: PulseDto | null,
  ): Promise<undefined | false>;
  unauthorized(): void;
}) {
  let previous = options.initial;
  let stopped = false;
  let busy = false;
  let interval = PULSE_INTERVAL_MS;
  let retryInterval = PULSE_INTERVAL_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();

  function schedule() {
    clearTimeout(timer);
    if (!stopped && options.visible()) timer = setTimeout(poll, interval);
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    controller.abort();
    unsubscribe();
  }
  async function poll() {
    if (stopped || busy || !options.visible()) return;
    busy = true;
    let loaded = false;
    try {
      const pulse = await options.load(controller.signal);
      loaded = true;
      interval = PULSE_INTERVAL_MS;
      retryInterval = PULSE_INTERVAL_MS;
      if (
        !stopped &&
        options.visible() &&
        (!previous ||
          pulse.latestAt !== previous.latestAt ||
          pulse.unread !== previous.unread)
      ) {
        if ((await options.changed(pulse, previous)) !== false)
          previous = pulse;
      }
    } catch (error) {
      if (stopped) return;
      if (!loaded) {
        if (error instanceof PulseHttpError) {
          if (error.status === 401 || error.status === 403) {
            stop();
            if (error.status === 401) options.unauthorized();
            return;
          }
          if (error.status < 500) {
            interval = PULSE_INTERVAL_MS;
            return;
          }
        }
        interval = retryInterval;
        retryInterval = Math.min(retryInterval * 2, MAX_RETRY_INTERVAL_MS);
      }
    } finally {
      busy = false;
      schedule();
    }
  }
  const unsubscribe = options.subscribe(() => {
    clearTimeout(timer);
    if (options.visible()) void poll();
  });
  void poll();
  return stop;
}
