import type { CaptureIngestionSummary, CaptureSession, TraceEvent } from "@skill-factory/shared";

type WindowPreset = CaptureSession["window"]["preset"];
const PRESETS = new Set<WindowPreset>(["1h", "24h", "7d", "30d", "custom"]);

export function normalizeWindow(
  raw: unknown,
): { preset: WindowPreset; customHours?: number } {
  if (typeof raw !== "object" || raw === null) return { preset: "24h" };
  const w = raw as Record<string, unknown>;
  const preset = w.preset;
  if (typeof preset === "string" && PRESETS.has(preset as WindowPreset)) {
    const p = preset as WindowPreset;
    const ch = w.customHours;
    const customHours =
      p === "custom" && typeof ch === "number" && Number.isFinite(ch) ? ch : undefined;
    return { preset: p, ...(customHours !== undefined ? { customHours } : {}) };
  }
  return { preset: "24h" };
}

/** Minimal validation aligned with the Chrome extension `TraceEvent` export shape. */
export function normalizeTraceEvents(raw: unknown): { events: TraceEvent[]; droppedInvalid: number } {
  if (!Array.isArray(raw)) return { events: [], droppedInvalid: 0 };
  const events: TraceEvent[] = [];
  let droppedInvalid = 0;
  for (const item of raw) {
    const ev = coerceTraceEvent(item);
    if (ev) events.push(ev);
    else droppedInvalid += 1;
  }
  return { events, droppedInvalid };
}

function coerceTraceEvent(raw: unknown): TraceEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const url = typeof o.url === "string" ? o.url : "";
  const capturedAt = typeof o.capturedAt === "string" ? o.capturedAt : "";
  if (!url || !capturedAt) return null;
  let origin = typeof o.origin === "string" ? o.origin : "";
  let path = typeof o.path === "string" ? o.path : "";
  try {
    const u = new URL(url);
    if (!origin) origin = u.origin;
    if (!path) path = u.pathname;
  } catch {
    return null;
  }
  const dwellMs =
    typeof o.dwellMs === "number" && Number.isFinite(o.dwellMs) ? Math.max(0, o.dwellMs) : 0;
  const source =
    o.source === "live" || o.source === "history" ? o.source : undefined;
  const title = typeof o.title === "string" ? o.title : undefined;
  const visitCount =
    typeof o.visitCount === "number" && Number.isFinite(o.visitCount) ? o.visitCount : undefined;
  const transition = isTransition(o.transition) ? o.transition : undefined;

  return {
    url,
    origin,
    path,
    dwellMs,
    capturedAt,
    ...(source ? { source } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(visitCount !== undefined ? { visitCount } : {}),
    ...(transition ? { transition } : {}),
  };
}

function isTransition(
  x: unknown,
): x is NonNullable<TraceEvent["transition"]> {
  return (
    x === "navigation" ||
    x === "visibility" ||
    x === "tab_switch" ||
    x === "tab_close" ||
    x === "capture_stop" ||
    x === "history_import"
  );
}

export function summarizeIngestion(events: TraceEvent[], droppedInvalid: number): CaptureIngestionSummary {
  let historyCount = 0;
  let liveCount = 0;
  let otherCount = 0;
  const origins = new Set<string>();
  for (const e of events) {
    origins.add(e.origin);
    if (e.source === "history") historyCount += 1;
    else if (e.source === "live") liveCount += 1;
    else otherCount += 1;
  }
  return {
    eventCount: events.length,
    historyCount,
    liveCount,
    otherCount,
    uniqueOrigins: [...origins].sort((a, b) => a.localeCompare(b)),
    droppedInvalid,
  };
}
