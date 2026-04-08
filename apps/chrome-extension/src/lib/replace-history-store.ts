import { migrateLegacyIfPresent } from "./migrate-legacy.js";
import { EVENTS_HISTORY_KEY } from "./storage-keys.js";
import type { TraceEvent } from "./types.js";

/** Wait until the service worker has finished startup wipe / migration ordering. */
async function ensureServiceWorkerStorageReady(): Promise<void> {
  const res = (await chrome.runtime.sendMessage({ type: "ENSURE_STORAGE_INIT" })) as {
    ok?: boolean;
  };
  if (!res?.ok) {
    throw new Error("Extension storage is not ready. Close and reopen the popup.");
  }
}

/** Replace the history track with this batch (after legacy migration). */
export async function replaceHistoryStore(events: TraceEvent[]): Promise<void> {
  await ensureServiceWorkerStorageReady();
  await migrateLegacyIfPresent();
  await chrome.storage.local.remove(EVENTS_HISTORY_KEY);
  await chrome.storage.local.set({ [EVENTS_HISTORY_KEY]: events });
}
