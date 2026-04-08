import { fetchHistoryAsTraceEvents } from "./lib/history-import.js";
import { replaceHistoryStore } from "./lib/replace-history-store.js";

const preset = document.getElementById("preset") as HTMLSelectElement;
const historyRange = document.getElementById("historyRange") as HTMLSelectElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const liveModeLabel = document.getElementById("liveModeLabel") as HTMLSpanElement;
const statusDetail = document.getElementById("statusDetail") as HTMLDivElement;
const historyTrackStat = document.getElementById("historyTrackStat") as HTMLParagraphElement;
const importHistoryBtn = document.getElementById("importHistory") as HTMLButtonElement;
const harnessGenerationBtn = document.getElementById("harnessGeneration") as HTMLButtonElement;
const out = document.getElementById("out") as HTMLPreElement;

function setImportUiIdle(): void {
  harnessGenerationBtn.disabled = false;
  historyRange.disabled = false;
  importHistoryBtn.disabled = false;
}

function setImportUiBusy(): void {
  harnessGenerationBtn.disabled = true;
  historyRange.disabled = true;
  importHistoryBtn.disabled = true;
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

async function refreshStatus(): Promise<boolean> {
  const res = (await chrome.runtime.sendMessage({
    type: "GET_STATUS",
    historyStatsPreset: historyRange.value as import("./lib/types.js").CapturePreset,
  })) as {
    ok?: boolean;
    active?: boolean;
    preset?: import("./lib/types.js").CapturePreset;
    liveCount?: number;
    historyCountTotal?: number;
    historyCountInRange?: number;
    trackingTabs?: number;
    activePreview?: { origin: string; path: string; dwellSoFarMs: number } | null;
  };
  if (!res?.ok) {
    liveModeLabel.textContent = "Live: ?";
    statusDetail.textContent = "Session unreadable.";
    historyTrackStat.textContent = "Summary unavailable.";
    statusEl.className = "idle";
    return false;
  }
  preset.value = res.preset ?? preset.value;
  statusEl.className = res.active ? "recording" : "idle";

  liveModeLabel.textContent = res.active ? "Live: On" : "Live: Off";

  const rangeLabel = historyRange.selectedOptions[0]?.text ?? historyRange.value;
  const inRange = res.historyCountInRange ?? 0;
  const total = res.historyCountTotal ?? 0;
  historyTrackStat.textContent = `${rangeLabel}: ${inRange} in window, ${total} last import.`;

  const L = res.liveCount ?? 0;

  if (res.active) {
    const preview = res.activePreview;
    const head = `${L} live row${L === 1 ? "" : "s"}`;
    const hint =
      preview != null
        ? `${preview.origin}${preview.path} · ~${formatDuration(preview.dwellSoFarMs)}. Navigate away or switch tab to add a row.`
        : "http(s) tab — rows add when you leave a page or tab.";
    statusDetail.textContent = `${head}. ${hint}`;
  } else {
    statusDetail.textContent =
      L === 0
        ? "No live rows yet. Use Online Discovery."
        : `Off · ${L} live row${L === 1 ? "" : "s"}.`;
  }
  return Boolean(res.active);
}

let statusTimer: number | undefined;

void (async () => {
  const active = await refreshStatus();
  if (active) kickStatusPolling();
})();

function kickStatusPolling(): void {
  if (statusTimer != null) window.clearInterval(statusTimer);
  statusTimer = window.setInterval(() => {
    void refreshStatus();
  }, 2000);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refreshStatus();
});

historyRange.addEventListener("change", () => {
  void refreshStatus();
});

document.getElementById("harnessGeneration")?.addEventListener("click", () => {
  const url = chrome.runtime.getURL("review.html");
  void chrome.tabs.create({ url });
});

importHistoryBtn.addEventListener("click", async () => {
  const range = historyRange.value as import("./lib/types.js").CapturePreset;
  out.hidden = false;
  out.textContent = "";
  setImportUiBusy();
  try {
    const { events, skipped } = await fetchHistoryAsTraceEvents(range);
    await replaceHistoryStore(events);
    const statusMini = (await chrome.runtime.sendMessage({
      type: "GET_STATUS",
      historyStatsPreset: range,
    })) as { liveCount?: number; historyCountTotal?: number };
    out.textContent = JSON.stringify(
      {
        ok: true,
        imported: events.length,
        skipped,
        historyTotal: events.length,
        liveTotal: statusMini.liveCount ?? 0,
      },
      null,
      2,
    );
  } catch (e) {
    out.textContent = `Import failed: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    setImportUiIdle();
    await refreshStatus();
  }
});

document.getElementById("start")?.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({
    type: "START_CAPTURE",
    preset: preset.value as import("./lib/types.js").CapturePreset,
  });
  out.hidden = true;
  await refreshStatus();
  kickStatusPolling();
});

document.getElementById("stop")?.addEventListener("click", async () => {
  if (statusTimer != null) {
    window.clearInterval(statusTimer);
    statusTimer = undefined;
  }
  const res = (await chrome.runtime.sendMessage({ type: "STOP_CAPTURE" })) as {
    ok?: boolean;
    count?: number;
    events?: unknown[];
  };
  out.hidden = false;
  out.textContent = JSON.stringify(res, null, 2);
  await refreshStatus();
});

document.getElementById("clear")?.addEventListener("click", async () => {
  if (!confirm("Delete all live and history rows stored by this extension on this device?")) return;
  await chrome.runtime.sendMessage({ type: "CLEAR_EVENTS" });
  out.hidden = true;
  const active = await refreshStatus();
  if (active) kickStatusPolling();
});
