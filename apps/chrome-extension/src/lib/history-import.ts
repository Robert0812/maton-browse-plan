import type { CapturePreset, TraceEvent } from "./types.js";
import { isCapturableUrl } from "./sanitize.js";
import { presetToStartMs } from "./time-range.js";

export interface HistoryImportResult {
  events: TraceEvent[];
  skipped: number;
}

export function historyItemsToTraceEvents(items: chrome.history.HistoryItem[]): HistoryImportResult {
  const events: TraceEvent[] = [];
  let skipped = 0;

  for (const h of items) {
    if (!h.url || !isCapturableUrl(h.url)) {
      skipped += 1;
      continue;
    }
    try {
      const u = new URL(h.url);
      const lastVisitTime = h.lastVisitTime ?? Date.now();
      events.push({
        url: h.url,
        origin: u.origin,
        path: u.pathname,
        dwellMs: 0,
        capturedAt: new Date(lastVisitTime).toISOString(),
        transition: "history_import",
        source: "history",
        visitCount: h.visitCount,
        title: h.title || undefined,
      });
    } catch {
      skipped += 1;
    }
  }

  events.sort(
    (a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
  );

  return { events, skipped };
}

/** One row per URL: keep the latest capturedAt when duplicates exist. */
export function dedupeHistoryTraceEvents(events: TraceEvent[]): TraceEvent[] {
  const byUrl = new Map<string, TraceEvent>();
  for (const e of events) {
    const prev = byUrl.get(e.url);
    const t = new Date(e.capturedAt).getTime();
    if (Number.isNaN(t)) continue;
    if (!prev || t >= new Date(prev.capturedAt).getTime()) {
      byUrl.set(e.url, e);
    }
  }
  return [...byUrl.values()].sort(
    (a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
  );
}

/**
 * One `chrome.history.search` for the whole window (avoids slice overlap quirks).
 * Progress is estimated until the search completes.
 */
export async function fetchHistoryAsTraceEventsWithProgress(
  preset: CapturePreset,
  onProgress: (percent: number) => void,
): Promise<HistoryImportResult> {
  const startTime = presetToStartMs(preset);
  onProgress(0);

  let fake = 0;
  const timer = window.setInterval(() => {
    fake = Math.min(fake + 4, 90);
    onProgress(fake);
  }, 45);

  try {
    const items = await chrome.history.search({
      text: "",
      startTime,
      maxResults: 100_000,
    });
    const { events, skipped } = historyItemsToTraceEvents(items);
    return { events: dedupeHistoryTraceEvents(events), skipped };
  } finally {
    window.clearInterval(timer);
    onProgress(100);
  }
}

/** One-shot import (no progress); used where UI is not available. */
export async function fetchHistoryAsTraceEvents(
  preset: CapturePreset,
): Promise<HistoryImportResult> {
  const startTime = presetToStartMs(preset);
  const items = await chrome.history.search({
    text: "",
    startTime,
    maxResults: 100_000,
  });
  const { events, skipped } = historyItemsToTraceEvents(items);
  return { events: dedupeHistoryTraceEvents(events), skipped };
}
