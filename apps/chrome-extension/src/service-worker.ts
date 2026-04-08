import type { CapturePreset, TraceEvent } from "./lib/types.js";
import { isCapturableUrl } from "./lib/sanitize.js";
import { migrateLegacyIfPresent } from "./lib/migrate-legacy.js";
import { presetToStartMs } from "./lib/time-range.js";
import {
  EVENTS_HISTORY_KEY,
  EVENTS_LIVE_KEY,
  LEGACY_EVENTS_KEY,
} from "./lib/storage-keys.js";

function countHistoryRowsInWindow(events: TraceEvent[], preset: CapturePreset): number {
  const startMs = presetToStartMs(preset);
  return events.filter((e) => {
    const t = new Date(e.capturedAt).getTime();
    return !Number.isNaN(t) && t >= startMs;
  }).length;
}

const SESSION_STATE_KEY = "sf_sw_session_v1";

interface SegmentState {
  lastActiveTabId: number | null;
  tabSegments: Record<string, { url: string; since: number }>;
}

async function loadLiveEvents(): Promise<TraceEvent[]> {
  await migrateLegacyIfPresent();
  const { [EVENTS_LIVE_KEY]: raw } = await chrome.storage.local.get(EVENTS_LIVE_KEY);
  return Array.isArray(raw) ? raw : [];
}

async function loadHistoryEvents(): Promise<TraceEvent[]> {
  await migrateLegacyIfPresent();
  const { [EVENTS_HISTORY_KEY]: raw } = await chrome.storage.local.get(EVENTS_HISTORY_KEY);
  return Array.isArray(raw) ? raw : [];
}

async function appendLiveEvent(ev: TraceEvent): Promise<void> {
  const all = await loadLiveEvents();
  all.push(ev);
  await chrome.storage.local.set({ [EVENTS_LIVE_KEY]: all });
}

function mergeForHarness(h: TraceEvent[], l: TraceEvent[]): TraceEvent[] {
  return [...h, ...l].sort(
    (a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
  );
}

/** Store-distributed builds set `update_url`; unpacked dev loads usually omit it. */
function isLikelyUnpackedDevBuild(): boolean {
  return chrome.runtime.getManifest().update_url === undefined;
}

const UNPACKED_BUNDLE_BUILD_KEY = "sf_unpacked_bundle_build_id";

/** Wipe trace keys + in-flight live session (used after unpacked reload). */
async function wipeAllTraceStorageForDevReload(): Promise<void> {
  await chrome.storage.local.remove([
    EVENTS_LIVE_KEY,
    EVENTS_HISTORY_KEY,
    LEGACY_EVENTS_KEY,
    "sf_capture_active",
  ]);
  await chrome.storage.session.remove(SESSION_STATE_KEY);
}

/**
 * Unpacked dev: each `npm run build` gets a new __BUILD_ID__. On SW start, if it
 * differs from what we stored, wipe trace storage. Reload alone (same build)
 * keeps data; rebuild + reload resets counts. Store builds set `update_url` → skipped.
 */
async function wipeIfNewUnpackedBundle(): Promise<void> {
  if (!isLikelyUnpackedDevBuild()) return;
  const { [UNPACKED_BUNDLE_BUILD_KEY]: prev } = await chrome.storage.local.get(UNPACKED_BUNDLE_BUILD_KEY);
  if (prev === __BUILD_ID__) return;
  await wipeAllTraceStorageForDevReload();
  await chrome.storage.local.set({ [UNPACKED_BUNDLE_BUILD_KEY]: __BUILD_ID__ });
}

async function loadSegmentState(): Promise<SegmentState> {
  const { [SESSION_STATE_KEY]: s } = await chrome.storage.session.get(SESSION_STATE_KEY);
  return (s as SegmentState) ?? { lastActiveTabId: null, tabSegments: {} };
}

async function saveSegmentState(s: SegmentState): Promise<void> {
  await chrome.storage.session.set({ [SESSION_STATE_KEY]: s });
}

async function isCaptureActive(): Promise<boolean> {
  const { sf_capture_active: a } = await chrome.storage.local.get("sf_capture_active");
  return Boolean(a);
}

/** Toolbar hint: live recording on (green dot) vs off. */
async function syncLiveRecordingBadge(): Promise<void> {
  try {
    if (await isCaptureActive()) {
      await chrome.action.setBadgeText({ text: "●" });
      await chrome.action.setBadgeBackgroundColor({ color: "#15803d" });
      await chrome.action.setTitle({
        title: "Skill Factory · Live recording ON — click for details",
      });
    } else {
      await chrome.action.setBadgeText({ text: "" });
      await chrome.action.setTitle({
        title: "Skill Factory · Live recording OFF",
      });
    }
  } catch {
    /* ignore */
  }
}

/**
 * Unpacked dev wipe must finish before any storage read/write from the popup or
 * handlers; otherwise `remove(EVENTS_HISTORY_KEY)` during wipe can run after
 * the popup's `set()` and silently delete a fresh import.
 */
const storageInitDone = (async () => {
  try {
    await wipeIfNewUnpackedBundle();
    await syncLiveRecordingBadge();
  } catch (e) {
    console.error("[skill-factory] storage init failed", e);
  }
})();

function keyTab(tabId: number): string {
  return String(tabId);
}

async function finalizeTabSegment(
  state: SegmentState,
  tabId: number,
  now: number,
  transition: TraceEvent["transition"],
): Promise<void> {
  const key = keyTab(tabId);
  const seg = state.tabSegments[key];
  if (!seg || !isCapturableUrl(seg.url)) {
    delete state.tabSegments[key];
    return;
  }
  const dwellMs = Math.max(0, now - seg.since);
  try {
    const u = new URL(seg.url);
    await appendLiveEvent({
      url: seg.url,
      origin: u.origin,
      path: u.pathname,
      dwellMs,
      capturedAt: new Date(seg.since).toISOString(),
      source: "live",
      transition,
    });
  } catch {
    /* ignore */
  }
  delete state.tabSegments[key];
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    await storageInitDone;
    switch (message?.type) {
      case "ENSURE_STORAGE_INIT": {
        sendResponse({ ok: true });
        break;
      }
      case "GET_STATUS": {
        const active = await isCaptureActive();
        const preset = (await chrome.storage.local.get("sf_capture_preset")).sf_capture_preset as
          | CapturePreset
          | undefined;
        const liveEvents = await loadLiveEvents();
        const historyEvents = await loadHistoryEvents();
        const liveCount = liveEvents.length;
        const historyCountTotal = historyEvents.length;
        const historyStatsPreset =
          (message?.historyStatsPreset as CapturePreset | undefined) ?? undefined;
        const historyCountInRange = historyStatsPreset
          ? countHistoryRowsInWindow(historyEvents, historyStatsPreset)
          : historyCountTotal;
        const segState = await loadSegmentState();
        const trackingTabs = Object.keys(segState.tabSegments).length;
        let activePreview: { origin: string; path: string; dwellSoFarMs: number } | null = null;
        if (segState.lastActiveTabId != null) {
          const seg = segState.tabSegments[keyTab(segState.lastActiveTabId)];
          if (seg?.url && isCapturableUrl(seg.url)) {
            try {
              const u = new URL(seg.url);
              activePreview = {
                origin: u.origin,
                path: u.pathname,
                dwellSoFarMs: Math.max(0, Date.now() - seg.since),
              };
            } catch {
              /* ignore */
            }
          }
        }
        sendResponse({
          ok: true,
          active,
          preset: preset ?? "24h",
          liveCount,
          historyCountTotal,
          historyCountInRange,
          trackingTabs,
          activePreview,
        });
        break;
      }
      case "START_CAPTURE": {
        await chrome.storage.local.set({
          sf_capture_active: true,
          sf_capture_preset: message.preset as CapturePreset,
        });
        await chrome.storage.session.remove(SESSION_STATE_KEY);
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const t = tabs[0];
        const now = Date.now();
        const state: SegmentState = { lastActiveTabId: t?.id ?? null, tabSegments: {} };
        if (t?.id != null && t.url && isCapturableUrl(t.url)) {
          state.tabSegments[keyTab(t.id)] = { url: t.url, since: now };
        }
        await saveSegmentState(state);
        await syncLiveRecordingBadge();
        sendResponse({ ok: true });
        break;
      }
      case "STOP_CAPTURE": {
        const now = Date.now();
        const state = await loadSegmentState();
        if (state.lastActiveTabId != null) {
          await finalizeTabSegment(state, state.lastActiveTabId, now, "capture_stop");
          state.lastActiveTabId = null;
        }
        await saveSegmentState(state);
        await chrome.storage.local.set({ sf_capture_active: false });
        await syncLiveRecordingBadge();
        const events = await loadLiveEvents();
        sendResponse({ ok: true, count: events.length, events });
        break;
      }
      case "GET_EVENTS": {
        const events = mergeForHarness(await loadHistoryEvents(), await loadLiveEvents());
        sendResponse({ ok: true, events });
        break;
      }
      case "GET_HARNESS_REVIEW_DATA": {
        const historyEvents = await loadHistoryEvents();
        const liveEvents = await loadLiveEvents();
        const events = mergeForHarness(historyEvents, liveEvents);
        const { sf_capture_preset: p } = await chrome.storage.local.get("sf_capture_preset");
        sendResponse({
          ok: true,
          events,
          preset: (p as CapturePreset) ?? "24h",
          liveCount: liveEvents.length,
          historyCount: historyEvents.length,
        });
        break;
      }
      case "CLEAR_EVENTS": {
        await chrome.storage.local.set({
          [EVENTS_LIVE_KEY]: [],
          [EVENTS_HISTORY_KEY]: [],
        });
        await chrome.storage.local.remove(LEGACY_EVENTS_KEY);
        await chrome.storage.session.remove(SESSION_STATE_KEY);
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false, error: "unknown_message" });
    }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  void syncLiveRecordingBadge();
});

chrome.runtime.onStartup.addListener(() => {
  void syncLiveRecordingBadge();
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await storageInitDone;
  if (!(await isCaptureActive())) return;
  const now = Date.now();
  const state = await loadSegmentState();
  const { tabId } = activeInfo;

  if (state.lastActiveTabId != null && state.lastActiveTabId !== tabId) {
    await finalizeTabSegment(state, state.lastActiveTabId, now, "tab_switch");
  }

  state.lastActiveTabId = tabId;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && isCapturableUrl(tab.url)) {
      state.tabSegments[keyTab(tabId)] = { url: tab.url, since: now };
    }
  } catch {
    /* tab may be closing */
  }
  await saveSegmentState(state);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  await storageInitDone;
  if (!(await isCaptureActive())) return;

  const nextUrl =
    changeInfo.url && isCapturableUrl(changeInfo.url)
      ? changeInfo.url
      : changeInfo.status === "complete" && tab.url && isCapturableUrl(tab.url)
        ? tab.url
        : null;

  if (!nextUrl) return;

  const now = Date.now();
  const state = await loadSegmentState();
  const key = keyTab(tabId);
  const existing = state.tabSegments[key];

  if (existing && existing.url !== nextUrl) {
    await finalizeTabSegment(state, tabId, now, "navigation");
    state.tabSegments[key] = { url: nextUrl, since: now };
  } else if (!existing) {
    state.tabSegments[key] = { url: nextUrl, since: now };
  }

  if (state.lastActiveTabId == null) state.lastActiveTabId = tabId;
  await saveSegmentState(state);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await storageInitDone;
  if (!(await isCaptureActive())) return;
  const now = Date.now();
  const state = await loadSegmentState();
  await finalizeTabSegment(state, tabId, now, "tab_close");
  if (state.lastActiveTabId === tabId) state.lastActiveTabId = null;
  delete state.tabSegments[keyTab(tabId)];
  await saveSegmentState(state);
});
