import { runHistoryRescanAndRelayIngest } from "./lib/capture-pipeline.js";
import { mergeHistoryAndLive } from "./lib/merge-events.js";
import { getRelayPortFromSettings } from "./lib/relay-client.js";
import { migrateLegacyIfPresent } from "./lib/migrate-legacy.js";
import { isCapturableUrl } from "./lib/sanitize.js";
import {
  EVENTS_HISTORY_KEY,
  EVENTS_LIVE_KEY,
  LEGACY_EVENTS_KEY,
  MATON_RELAY_REFRESH_ALARM,
  SF_CAPTURE_PRESET_KEY,
  SF_LAST_INGEST_STATS_KEY,
  SF_LAST_RELAY_PUSH_AT_KEY,
  SF_RELAY_REFRESH_PRESET_KEY,
  SF_RELAY_SESSION_ACTIVE_KEY,
} from "./lib/storage-keys.js";
import { presetToStartMs, relayRefreshPresetToPeriodMs } from "./lib/time-range.js";
import type { CapturePreset, LastIngestStats, RelayRefreshPreset, TraceEvent } from "./lib/types.js";

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
        title: "Maton browse plan · Live recording ON — click for details",
      });
    } else {
      await chrome.action.setBadgeText({ text: "" });
      await chrome.action.setTitle({
        title: "Maton browse plan · Live recording OFF",
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
    console.error("[maton-browse-plan] storage init failed", e);
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
        const stored = await chrome.storage.local.get([
          SF_CAPTURE_PRESET_KEY,
          SF_RELAY_SESSION_ACTIVE_KEY,
          SF_LAST_RELAY_PUSH_AT_KEY,
          SF_RELAY_REFRESH_PRESET_KEY,
          SF_LAST_INGEST_STATS_KEY,
        ]);
        const preset = stored[SF_CAPTURE_PRESET_KEY] as CapturePreset | undefined;
        const historyWindowPreset = preset ?? "3d";
        const relaySessionActive = stored[SF_RELAY_SESSION_ACTIVE_KEY] === true;
        const relayRefreshPreset = (stored[SF_RELAY_REFRESH_PRESET_KEY] as RelayRefreshPreset | undefined) ?? "3h";
        const lastRelayPushAt =
          typeof stored[SF_LAST_RELAY_PUSH_AT_KEY] === "string" ? stored[SF_LAST_RELAY_PUSH_AT_KEY] : null;
        const rawIngest = stored[SF_LAST_INGEST_STATS_KEY];
        const lastIngestStats: LastIngestStats | null =
          rawIngest &&
          typeof rawIngest === "object" &&
          rawIngest !== null &&
          typeof (rawIngest as LastIngestStats).eventCount === "number"
            ? (rawIngest as LastIngestStats)
            : null;
        const periodMs = relayRefreshPresetToPeriodMs(relayRefreshPreset);
        let nextRelayRefreshAt: number | null = null;
        if (relaySessionActive && lastRelayPushAt) {
          const t = Date.parse(lastRelayPushAt);
          if (!Number.isNaN(t)) nextRelayRefreshAt = t + periodMs;
        }
        const liveEvents = await loadLiveEvents();
        const historyEvents = await loadHistoryEvents();
        const liveCount = liveEvents.length;
        const historyCountTotal = historyEvents.length;
        const historyStatsPreset =
          (message?.historyStatsPreset as CapturePreset | undefined) ?? historyWindowPreset;
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
          preset: historyWindowPreset,
          relaySessionActive,
          relayRefreshPreset,
          lastRelayPushAt,
          nextRelayRefreshAt,
          lastIngestStats,
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
          [SF_CAPTURE_PRESET_KEY]: message.preset as CapturePreset,
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
        const events = mergeHistoryAndLive(await loadHistoryEvents(), await loadLiveEvents());
        sendResponse({ ok: true, events });
        break;
      }
      case "GET_HARNESS_REVIEW_DATA": {
        const historyEvents = await loadHistoryEvents();
        const liveEvents = await loadLiveEvents();
        const events = mergeHistoryAndLive(historyEvents, liveEvents);
        const { [SF_CAPTURE_PRESET_KEY]: p } = await chrome.storage.local.get(SF_CAPTURE_PRESET_KEY);
        sendResponse({
          ok: true,
          events,
          preset: (p as CapturePreset) ?? "3d",
          liveCount: liveEvents.length,
          historyCount: historyEvents.length,
        });
        break;
      }
      case "CLEAR_EVENTS": {
        const now = Date.now();
        const state = await loadSegmentState();
        if (await isCaptureActive() && state.lastActiveTabId != null) {
          await finalizeTabSegment(state, state.lastActiveTabId, now, "capture_stop");
        }
        await saveSegmentState({ lastActiveTabId: null, tabSegments: {} });
        await chrome.alarms.clear(MATON_RELAY_REFRESH_ALARM);
        await chrome.storage.local.set({
          sf_capture_active: false,
          [EVENTS_LIVE_KEY]: [],
          [EVENTS_HISTORY_KEY]: [],
          [SF_RELAY_SESSION_ACTIVE_KEY]: false,
        });
        await chrome.storage.local.remove([LEGACY_EVENTS_KEY, SF_LAST_RELAY_PUSH_AT_KEY, SF_LAST_INGEST_STATS_KEY]);
        await chrome.storage.session.remove(SESSION_STATE_KEY);
        await syncLiveRecordingBadge();
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false, error: "unknown_message" });
    }
  })();
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== MATON_RELAY_REFRESH_ALARM) return;
  void (async () => {
    await storageInitDone;
    try {
      const { [SF_RELAY_SESSION_ACTIVE_KEY]: active, [SF_CAPTURE_PRESET_KEY]: preset } =
        await chrome.storage.local.get([SF_RELAY_SESSION_ACTIVE_KEY, SF_CAPTURE_PRESET_KEY]);
      if (active !== true) return;
      const p = (preset as CapturePreset | undefined) ?? "3d";
      const result = await runHistoryRescanAndRelayIngest(p);
      if (result.ok) {
        const relayPort = await getRelayPortFromSettings();
        const stats: LastIngestStats = {
          eventCount: result.eventCount,
          skipped: result.skipped,
          siteCount: result.siteCount,
          relayPort,
        };
        await chrome.storage.local.set({
          [SF_LAST_RELAY_PUSH_AT_KEY]: new Date().toISOString(),
          [SF_LAST_INGEST_STATS_KEY]: stats,
        });
      } else {
        console.warn("[maton-browse] relay refresh failed", result.detail);
      }
    } catch (e) {
      console.error("[maton-browse] relay alarm failed", e);
    }
  })();
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
