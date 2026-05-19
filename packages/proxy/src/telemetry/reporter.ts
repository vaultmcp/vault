/// Telemetry reporter — batched, fire-and-forget HTTP POST of redacted events.
/// Never delays or fails proxy operation. On endpoint failure, logs once and drops the batch.

import {
  newId,
  resolveInstallId,
  type CapabilityEvent,
  type DetectionEvent,
  type ManifestEvent,
  type TelemetryEvent,
} from './event.js';

export interface TelemetryConfig {
  enabled: boolean;
  url?: string;
  secret?: string;
  batchSize: number;
  flushIntervalMs: number;
  /// True when telemetry is enabled because the user did not explicitly opt in
  /// (i.e. a collector URL was configured and they didn't set VAULT_TELEMETRY=0).
  /// The proxy uses this to print a one-line first-run banner on stderr.
  bannerOnStart?: boolean;
}

type Meta = 'id' | 'ts' | 'installId';
export type TelemetryEventInput =
  | Omit<DetectionEvent, Meta>
  | Omit<CapabilityEvent, Meta>
  | Omit<ManifestEvent, Meta>;

export interface TelemetryReporter {
  enabled: boolean;
  send(event: TelemetryEventInput): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

export function createReporter(
  config: TelemetryConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
): TelemetryReporter {
  if (!config.enabled || !config.url) {
    return {
      enabled: false,
      send() {},
      async flush() {},
      async shutdown() {},
    };
  }

  const installId = resolveInstallId();
  let buffer: TelemetryEvent[] = [];
  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<void> | null = null;
  let errorAnnouncedAt = 0;
  let shutdownCalled = false;

  function scheduleFlush(): void {
    if (timer || shutdownCalled) return;
    timer = setTimeout(() => {
      timer = null;
      void flushInternal();
    }, config.flushIntervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  async function flushInternal(): Promise<void> {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.secret) headers.Authorization = `Bearer ${config.secret}`;
    try {
      const resp = await fetchImpl(config.url!, {
        method: 'POST',
        headers,
        body: JSON.stringify({ events: batch }),
      });
      if (!resp.ok) {
        announceError(`HTTP ${resp.status}`);
      }
    } catch (err) {
      announceError(err instanceof Error ? err.message : String(err));
    }
  }

  function announceError(msg: string): void {
    const now = Date.now();
    // Throttle: only log once every 60s.
    if (now - errorAnnouncedAt < 60_000) return;
    errorAnnouncedAt = now;
    process.stderr.write(`vault: telemetry POST failed (${msg}); dropping events\n`);
  }

  return {
    enabled: true,
    send(partial: TelemetryEventInput) {
      if (shutdownCalled) return;
      const event = {
        ...(partial as object),
        id: newId(),
        ts: Date.now(),
        installId,
      } as TelemetryEvent;
      buffer.push(event);
      if (buffer.length >= config.batchSize) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        inFlight = (inFlight ?? Promise.resolve()).then(flushInternal);
        return;
      }
      scheduleFlush();
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await inFlight;
      await flushInternal();
    },
    async shutdown() {
      shutdownCalled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await inFlight;
      await flushInternal();
    },
  };
}
