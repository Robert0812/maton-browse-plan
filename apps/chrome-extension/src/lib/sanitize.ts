import type { TraceEvent } from "./types.js";

export function isCapturableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Strip query + hash before upload/export (reduces passive PII leakage). */
export function sanitizeEventForExport(ev: TraceEvent): TraceEvent {
  try {
    const u = new URL(ev.url);
    u.search = "";
    u.hash = "";
    return {
      ...ev,
      url: u.toString(),
      origin: u.origin,
      path: u.pathname,
    };
  } catch {
    return { ...ev };
  }
}

export function sanitizeBatch(events: TraceEvent[]): TraceEvent[] {
  return events.map(sanitizeEventForExport);
}

/**
 * For POST to Skill Factory API only: strip hash, **keep query string** so Phase 3 can cluster on params.
 * Downloads / local JSON should keep using `sanitizeEventForExport`.
 */
export function eventForCaptureApi(ev: TraceEvent): TraceEvent {
  try {
    const u = new URL(ev.url);
    u.hash = "";
    return {
      ...ev,
      url: u.toString(),
      origin: u.origin,
      path: u.pathname,
    };
  } catch {
    return { ...ev };
  }
}

export function batchForCaptureApi(events: TraceEvent[]): TraceEvent[] {
  return events.map(eventForCaptureApi);
}
