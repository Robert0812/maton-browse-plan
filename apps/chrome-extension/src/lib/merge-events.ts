import type { TraceEvent } from "./types.js";

/** Merge imported history rows with live-captured rows (newest first). */
export function mergeHistoryAndLive(history: TraceEvent[], live: TraceEvent[]): TraceEvent[] {
  return [...history, ...live].sort(
    (a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
  );
}
