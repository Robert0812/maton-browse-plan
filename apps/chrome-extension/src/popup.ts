import { runHistoryRescanAndRelayIngest } from "./lib/capture-pipeline.js";
import {
  formatNativeRelayError,
  nativeRelayStart,
  nativeRelayStop,
} from "./lib/native-relay.js";
import { capturePresetLabel, relayRefreshPresetLabel } from "./lib/preset-labels.js";
import {
  MATON_RELAY_REFRESH_ALARM,
  SF_CAPTURE_PRESET_KEY,
  SF_LAST_INGEST_STATS_KEY,
  SF_LAST_RELAY_PUSH_AT_KEY,
  SF_RELAY_REFRESH_PRESET_KEY,
  SF_RELAY_SESSION_ACTIVE_KEY,
} from "./lib/storage-keys.js";
import { relayRefreshPresetToPeriodMinutes } from "./lib/time-range.js";
import type { CapturePreset, LastIngestStats, RelayRefreshPreset } from "./lib/types.js";

const historyWindow = document.getElementById("historyWindow") as HTMLSelectElement;
const relayRefresh = document.getElementById("relayRefresh") as HTMLSelectElement;
const btnConsole = document.getElementById("btnConsole") as HTMLButtonElement;
const btnStart = document.getElementById("btnStart") as HTMLButtonElement;
const btnStop = document.getElementById("btnStop") as HTMLButtonElement;
const accumulationStatus = document.getElementById("accumulationStatus") as HTMLDivElement;

const TOP_SITES = 10;

function showPanelError(message: string): void {
  accumulationStatus.textContent = message;
  accumulationStatus.className = "accumulation-status err";
}

function formatClock(iso: string | undefined | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatNextPush(nextMs: number | null | undefined): string {
  if (nextMs == null || Number.isNaN(nextMs)) return "—";
  const now = Date.now();
  /** Scheduled time is in the past — refresh did not advance (relay down, missed alarm, etc.). */
  if (nextMs < now - 120_000) return "overdue — keep npm run relay running";
  const d = new Date(nextMs);
  if (nextMs <= now + 90_000) return "soon";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function relayPortAndToken(): Promise<{ port: number; token: string }> {
  const { maton_relay_base_url, maton_relay_token } = await chrome.storage.local.get([
    "maton_relay_base_url",
    "maton_relay_token",
  ]);
  let port = 37191;
  const base = typeof maton_relay_base_url === "string" ? maton_relay_base_url.trim() : "";
  if (base) {
    try {
      const u = new URL(base.includes("://") ? base : `http://${base}`);
      if (u.port) port = parseInt(u.port, 10);
    } catch {
      /* ignore */
    }
  }
  const token = typeof maton_relay_token === "string" ? maton_relay_token : "";
  return { port, token };
}

async function loadSavedUiPrefs(): Promise<void> {
  const { [SF_CAPTURE_PRESET_KEY]: hp, [SF_RELAY_REFRESH_PRESET_KEY]: rp } =
    await chrome.storage.local.get([SF_CAPTURE_PRESET_KEY, SF_RELAY_REFRESH_PRESET_KEY]);
  const validH: CapturePreset[] = ["1h", "24h", "3d", "7d", "30d"];
  if (typeof hp === "string" && validH.includes(hp as CapturePreset)) {
    historyWindow.value = hp;
  }
  const validR: RelayRefreshPreset[] = ["30m", "1h", "3h", "6h", "12h", "24h"];
  if (typeof rp === "string" && validR.includes(rp as RelayRefreshPreset)) {
    relayRefresh.value = rp;
  }
}

async function refreshAccumulationPanel(): Promise<void> {
  const res = (await chrome.runtime.sendMessage({ type: "GET_STATUS" })) as {
    ok?: boolean;
    relaySessionActive?: boolean;
    relayRefreshPreset?: RelayRefreshPreset;
    preset?: CapturePreset;
    lastRelayPushAt?: string | null;
    nextRelayRefreshAt?: number | null;
    lastIngestStats?: LastIngestStats | null;
    liveCount?: number;
    historyCountInRange?: number;
  };
  if (!res?.ok) return;

  if (!res.relaySessionActive) {
    const pickR = relayRefreshPresetLabel(relayRefresh.value as RelayRefreshPreset);
    const pickH = capturePresetLabel(historyWindow.value as CapturePreset);
    accumulationStatus.textContent =
      `Idle. Top sites rank over ${pickH} of history (below); after Start, the relay is updated every ${pickR} with fresh history + live visits.`;
    accumulationStatus.className = "accumulation-status idle";
    return;
  }

  const hw = capturePresetLabel((res.preset as CapturePreset) ?? "3d");
  const iv = relayRefreshPresetLabel((res.relayRefreshPreset as RelayRefreshPreset) ?? "3h");
  const live = res.liveCount ?? 0;
  const histInWin = res.historyCountInRange ?? 0;
  const last = formatClock(res.lastRelayPushAt);
  const next = formatNextPush(res.nextRelayRefreshAt ?? null);
  const st = res.lastIngestStats;
  const ingestBlock =
    st != null
      ? `<br /><strong>Last ingest</strong>: ${st.eventCount} merged rows (${st.skipped} skipped from history), top ${st.siteCount} sites, relay port <strong>${st.relayPort}</strong>. Live recording on — open <strong>Console</strong> for export.`
      : "";

  accumulationStatus.innerHTML = `<strong>Relay active</strong> — ranking over <strong>${hw}</strong> of history plus live visits. Pushes top ${TOP_SITES} to <span class="mono">GET /latest</span> every <strong>${iv}</strong>.${ingestBlock}<br />Last push: <strong>${last}</strong>.<br />Next refresh: <strong>~${next}</strong>.<br />Rows: <strong>${live}</strong> live, <strong>${histInWin}</strong> history in window.`;
  accumulationStatus.className = "accumulation-status active";
}

btnConsole.addEventListener("click", () => {
  const url = chrome.runtime.getURL("review.html");
  void chrome.tabs.create({ url });
});

btnStart.addEventListener("click", () => {
  void (async () => {
    const historyPreset = historyWindow.value as CapturePreset;
    const relayPreset = relayRefresh.value as RelayRefreshPreset;
    btnStart.disabled = true;
    btnStop.disabled = true;
    btnConsole.disabled = true;
    historyWindow.disabled = true;
    relayRefresh.disabled = true;
    try {
      await chrome.storage.local.set({
        [SF_CAPTURE_PRESET_KEY]: historyPreset,
        [SF_RELAY_REFRESH_PRESET_KEY]: relayPreset,
      });

      await chrome.runtime.sendMessage({ type: "CLEAR_EVENTS" });

      const { port, token } = await relayPortAndToken();
      const r = await nativeRelayStart(port, token.trim() || undefined);
      if (r.ok === false) {
        showPanelError(r.detail ?? r.error ?? "Relay failed to start.");
        return;
      }

      const ing = await runHistoryRescanAndRelayIngest(historyPreset);
      if (!ing.ok) {
        showPanelError(`Relay is up but ingest failed: ${ing.detail ?? "unknown"}`);
        return;
      }

      const stats: LastIngestStats = {
        eventCount: ing.eventCount,
        skipped: ing.skipped,
        siteCount: ing.siteCount,
        relayPort: port,
      };
      await chrome.storage.local.set({
        [SF_RELAY_SESSION_ACTIVE_KEY]: true,
        [SF_LAST_RELAY_PUSH_AT_KEY]: new Date().toISOString(),
        [SF_LAST_INGEST_STATS_KEY]: stats,
      });

      await chrome.alarms.clear(MATON_RELAY_REFRESH_ALARM);
      const refreshMin = relayRefreshPresetToPeriodMinutes(relayPreset);
      await chrome.alarms.create(MATON_RELAY_REFRESH_ALARM, {
        delayInMinutes: refreshMin,
        periodInMinutes: refreshMin,
      });

      await chrome.runtime.sendMessage({ type: "START_CAPTURE", preset: historyPreset });

      await refreshAccumulationPanel();
    } catch (e) {
      showPanelError(formatNativeRelayError(e));
    } finally {
      btnStart.disabled = false;
      btnStop.disabled = false;
      btnConsole.disabled = false;
      historyWindow.disabled = false;
      relayRefresh.disabled = false;
    }
  })();
});

btnStop.addEventListener("click", () => {
  void (async () => {
    btnStart.disabled = true;
    btnStop.disabled = true;
    btnConsole.disabled = true;
    historyWindow.disabled = true;
    relayRefresh.disabled = true;
    try {
      const { port } = await relayPortAndToken();
      const r = await nativeRelayStop(port);
      await chrome.runtime.sendMessage({ type: "CLEAR_EVENTS" });
      if (r.ok === false) {
        showPanelError(`Session cleared. Relay stop failed: ${r.detail ?? r.error ?? "unknown"}.`);
      } else {
        await refreshAccumulationPanel();
      }
    } catch (e) {
      try {
        await chrome.runtime.sendMessage({ type: "CLEAR_EVENTS" });
      } catch {
        /* ignore */
      }
      showPanelError(`Session cleared. ${formatNativeRelayError(e)}`);
      await refreshAccumulationPanel();
    } finally {
      btnStart.disabled = false;
      btnStop.disabled = false;
      btnConsole.disabled = false;
      historyWindow.disabled = false;
      relayRefresh.disabled = false;
    }
  })();
});

void chrome.runtime.sendMessage({ type: "ENSURE_STORAGE_INIT" }).catch(() => {
  /* ignore */
});

void loadSavedUiPrefs().then(() => refreshAccumulationPanel());
historyWindow.addEventListener("change", () => {
  void refreshAccumulationPanel();
});
relayRefresh.addEventListener("change", () => {
  void refreshAccumulationPanel();
});
setInterval(() => {
  void refreshAccumulationPanel();
}, 12_000);
