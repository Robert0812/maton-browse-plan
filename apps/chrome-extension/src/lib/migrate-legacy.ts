import type { TraceEvent } from "./types.js";
import { EVENTS_HISTORY_KEY, EVENTS_LIVE_KEY, LEGACY_EVENTS_KEY } from "./storage-keys.js";

/** Merge legacy single-key store into live/history, then drop legacy. */
export async function migrateLegacyIfPresent(): Promise<void> {
  const all = await chrome.storage.local.get([
    LEGACY_EVENTS_KEY,
    EVENTS_LIVE_KEY,
    EVENTS_HISTORY_KEY,
  ]);
  const raw = all[LEGACY_EVENTS_KEY];
  if (!Array.isArray(raw) || raw.length === 0) return;

  const existingLive = Array.isArray(all[EVENTS_LIVE_KEY]) ? [...all[EVENTS_LIVE_KEY]] : [];
  const existingHist = Array.isArray(all[EVENTS_HISTORY_KEY]) ? [...all[EVENTS_HISTORY_KEY]] : [];

  const splitLive: TraceEvent[] = [];
  const splitHist: TraceEvent[] = [];
  for (const e of raw as TraceEvent[]) {
    if (e.source === "history" || e.transition === "history_import") splitHist.push(e);
    else splitLive.push(e);
  }

  await chrome.storage.local.set({
    [EVENTS_LIVE_KEY]: [...existingLive, ...splitLive],
    [EVENTS_HISTORY_KEY]: [...existingHist, ...splitHist],
  });
  await chrome.storage.local.remove(LEGACY_EVENTS_KEY);
}
