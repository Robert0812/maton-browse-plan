import { buildIntentCluster } from "./lib/intent-cluster-heuristic.js";
import { buildMatonBrowseDerivedPlan } from "./lib/maton-plan.js";
import {
  DEFAULT_RELAY_BASE_URL,
  RELAY_START_COMMAND_SNIPPET,
  fetchRelayHealth,
  loadRelaySettings,
  postRelayIngest,
  saveRelaySettings,
} from "./lib/relay-client.js";
import { sanitizeBatch } from "./lib/sanitize.js";
import type { CapturePayload, CapturePreset, TraceEvent } from "./lib/types.js";

const statsEl = document.getElementById("stats") as HTMLDivElement;
const tbody = document.getElementById("tbody") as HTMLTableSectionElement;
const emptyState = document.getElementById("emptyState") as HTMLDivElement;
const intentPanel = document.getElementById("intentPanel") as HTMLElement;
const intentPanelBody = document.getElementById("intentPanelBody") as HTMLDivElement;
const exportPreset = document.getElementById("exportPreset") as HTMLSelectElement;
const btnDownload = document.getElementById("btnDownload") as HTMLButtonElement;
const result = document.getElementById("result") as HTMLPreElement;
const relayEnabled = document.getElementById("relayEnabled") as HTMLInputElement;
const relayBaseUrl = document.getElementById("relayBaseUrl") as HTMLInputElement;
const relayToken = document.getElementById("relayToken") as HTMLInputElement;
const btnRelayCopyCmd = document.getElementById("btnRelayCopyCmd") as HTMLButtonElement;
const btnRelayTest = document.getElementById("btnRelayTest") as HTMLButtonElement;
const relayBadge = document.getElementById("relayBadge") as HTMLSpanElement;
const relayStatus = document.getElementById("relayStatus") as HTMLDivElement;

const MAX_ROWS = 200;

let rawEvents: TraceEvent[] = [];
let liveCount = 0;
let historyCount = 0;
const excludedOrigins = new Set<string>();

function showResult(text: string): void {
  result.textContent = text;
  result.classList.add("visible");
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function getFilteredEvents(): TraceEvent[] {
  return sanitizeBatch(rawEvents).filter((ev) => !excludedOrigins.has(ev.origin));
}

function exportEventCount(): number {
  return getFilteredEvents().length;
}

function refreshStats(): void {
  const n = rawEvents.length;
  const exportN = exportEventCount();
  statsEl.innerHTML = `<span><strong>${n}</strong> rows</span><span><strong>${liveCount}</strong> live</span><span><strong>${historyCount}</strong> history</span><span><strong>${exportN}</strong> to export</span>`;
}

function linkify(url: string, label: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = label;
  return a;
}

function siteShortLabel(siteUrl: string): string {
  try {
    return new URL(siteUrl).hostname;
  } catch {
    return siteUrl;
  }
}

function hideIntentPanel(): void {
  intentPanel.hidden = true;
  intentPanelBody.replaceChildren();
}

function showIntentClusterForEvents(events: TraceEvent[]): void {
  intentPanelBody.replaceChildren();
  if (events.length === 0) {
    hideIntentPanel();
    return;
  }
  const { sites } = buildIntentCluster(events);
  intentPanel.hidden = false;
  if (sites.length === 0) {
    const p = document.createElement("p");
    p.className = "intent-no-fn";
    p.textContent =
      "No sites ranked yet from the current filter (need visit/dwell signals in the rows you are exporting).";
    intentPanelBody.appendChild(p);
    return;
  }
  for (const site of sites) {
    const block = document.createElement("div");
    block.className = "intent-site";
    const head = document.createElement("div");
    head.className = "intent-site-head";
    const rank = document.createElement("span");
    rank.className = "intent-rank";
    rank.textContent = `#${site.rank}`;
    const urlWrap = document.createElement("span");
    urlWrap.className = "intent-site-url";
    urlWrap.appendChild(linkify(site.siteUrl, siteShortLabel(site.siteUrl)));
    head.append(rank, urlWrap);
    const summary = document.createElement("p");
    summary.className = "intent-summary";
    summary.textContent = site.summary;
    block.append(head, summary);
    if (site.functions.length === 0) {
      const p = document.createElement("p");
      p.className = "intent-no-fn";
      p.textContent = "No query-bearing history URLs for this origin (no suggested functions).";
      block.appendChild(p);
    } else {
      const ul = document.createElement("ul");
      ul.className = "intent-fn-list";
      for (const fn of site.functions) {
        const li = document.createElement("li");
        const name = document.createElement("span");
        name.className = "intent-fn-name";
        name.textContent = fn.name;
        const desc = document.createElement("span");
        desc.className = "intent-fn-desc";
        desc.textContent = fn.description;
        const fnLink = linkify(fn.resourceUrl, fn.resourceUrl);
        fnLink.className = "intent-fn-link";
        li.append(name, desc, fnLink);
        ul.appendChild(li);
      }
      block.appendChild(ul);
    }
    intentPanelBody.appendChild(block);
  }
}

function updateExportDependentUi(): void {
  refreshStats();
  tbody.querySelectorAll("tr[data-origin]").forEach((tr) => {
    const o = tr.getAttribute("data-origin");
    if (!o) return;
    const excluded = excludedOrigins.has(o);
    tr.classList.toggle("row-excluded", excluded);
    const cb = tr.querySelector<HTMLInputElement>(".exclude-origin-cb");
    if (cb) cb.checked = excluded;
  });
  const canExport = rawEvents.length > 0 && exportEventCount() > 0;
  btnDownload.disabled = !canExport;
  if (canExport) {
    showIntentClusterForEvents(getFilteredEvents());
  } else {
    hideIntentPanel();
  }
}

async function load(): Promise<void> {
  const res = (await chrome.runtime.sendMessage({ type: "GET_HARNESS_REVIEW_DATA" })) as {
    ok?: boolean;
    events?: TraceEvent[];
    preset?: CapturePreset;
    liveCount?: number;
    historyCount?: number;
  };

  if (!res?.ok || !Array.isArray(res.events)) {
    showResult("Could not load trace data from the extension.");
    statsEl.textContent = "";
    emptyState.hidden = false;
    tbody.replaceChildren();
    rawEvents = [];
    liveCount = 0;
    historyCount = 0;
    excludedOrigins.clear();
    updateExportDependentUi();
    return;
  }

  rawEvents = res.events;
  exportPreset.value = res.preset ?? "24h";
  liveCount = res.liveCount ?? 0;
  historyCount = res.historyCount ?? 0;
  excludedOrigins.clear();

  const n = rawEvents.length;

  tbody.replaceChildren();
  if (n === 0) {
    emptyState.hidden = false;
    statsEl.innerHTML = "";
    tbody.replaceChildren();
    updateExportDependentUi();
    return;
  }

  emptyState.hidden = true;

  const sanitized = sanitizeBatch([...rawEvents]);
  const slice = sanitized.slice(0, MAX_ROWS);

  for (const ev of slice) {
    const tr = document.createElement("tr");
    tr.dataset.origin = ev.origin;
    const src = ev.source ?? (ev.transition === "history_import" ? "history" : "live");

    const tdEx = document.createElement("td");
    tdEx.className = "col-exclude";
    const exLabel = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "exclude-origin-cb";
    cb.title = `Exclude ${ev.origin} from export`;
    cb.setAttribute("aria-label", `Exclude origin ${ev.origin} from export`);
    cb.checked = excludedOrigins.has(ev.origin);
    cb.addEventListener("change", () => {
      if (cb.checked) excludedOrigins.add(ev.origin);
      else excludedOrigins.delete(ev.origin);
      updateExportDependentUi();
    });
    exLabel.appendChild(cb);
    tdEx.appendChild(exLabel);

    const tdSrc = document.createElement("td");
    tdSrc.textContent = src;

    const tdPath = document.createElement("td");
    tdPath.className = "mono";
    tdPath.textContent = `${ev.origin}${ev.path}`;

    const tdDwell = document.createElement("td");
    tdDwell.textContent = ev.dwellMs ? `${ev.dwellMs} ms` : "—";

    const tdWhen = document.createElement("td");
    tdWhen.textContent = formatWhen(ev.capturedAt);

    tr.append(tdEx, tdSrc, tdPath, tdDwell, tdWhen);
    tbody.appendChild(tr);
  }

  if (n > MAX_ROWS) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.style.fontStyle = "italic";
    td.style.color = "#71717a";
    td.textContent = `+${n - MAX_ROWS} more rows (full log; table exclusions still apply).`;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  updateExportDependentUi();
}

function buildPayload(): CapturePayload {
  const events = getFilteredEvents();
  const exportedAt = new Date().toISOString();
  const { sites } = buildIntentCluster(events);
  const matonPlan = buildMatonBrowseDerivedPlan(sites, exportedAt, exportPreset.value);
  return {
    preset: exportPreset.value as CapturePreset,
    events,
    exportedAt,
    matonPlan,
  };
}

btnDownload.addEventListener("click", () => {
  void (async () => {
    if (rawEvents.length === 0 || exportEventCount() === 0) return;
    const payload = buildPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `maton-browse-capture-${payload.exportedAt.slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    const baseUrl = relayBaseUrl.value.trim() || DEFAULT_RELAY_BASE_URL;
    await saveRelaySettings({
      enabled: relayEnabled.checked,
      baseUrl,
      token: relayToken.value,
    });

    const lines: string[] = [
      "Download started. Feed matonPlan to the ClawHub API Gateway · Browse skill (see repo skills/clawhub-api-gateway-browse).",
    ];
    if (relayEnabled.checked) {
      const r = await postRelayIngest(baseUrl, relayToken.value.trim() || undefined, payload);
      if (r.ok) {
        lines.push("Local relay: ingest OK — use GET /latest on the same base URL (e.g. for MCP or scripts).");
      } else {
        lines.push(`Local relay: ingest failed — ${r.detail ?? "error"}`);
      }
    }
    showResult(lines.join("\n\n"));
  })();
});

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function setRelayBadge(mode: "ok" | "err" | "neutral", label: string): void {
  relayBadge.textContent = label;
  relayBadge.className = "relay-badge" + (mode === "ok" ? " ok" : mode === "err" ? " err" : "");
}

async function refreshRelayStatus(): Promise<void> {
  setRelayBadge("neutral", "Relay: checking…");
  relayStatus.textContent = "";
  relayStatus.className = "relay-status";
  const url = relayBaseUrl.value.trim() || DEFAULT_RELAY_BASE_URL;
  const r = await fetchRelayHealth(url);
  if (r.ok) {
    setRelayBadge("ok", "Relay: running");
    relayStatus.textContent = `${url} — GET /health OK. Stop with Ctrl+C in that terminal.`;
    relayStatus.className = "relay-status ok";
  } else {
    setRelayBadge("err", "Relay: not running");
    relayStatus.textContent = `No response at ${url} — ${r.detail ?? "unknown"}. Copy start command, run in a terminal, then refresh.`;
    relayStatus.className = "relay-status err";
  }
}

async function initRelayPanel(): Promise<void> {
  const s = await loadRelaySettings();
  relayEnabled.checked = s.enabled;
  relayBaseUrl.value = s.baseUrl;
  relayToken.value = s.token;

  relayEnabled.addEventListener("change", () => {
    void saveRelaySettings({ enabled: relayEnabled.checked });
  });
  relayBaseUrl.addEventListener("blur", () => {
    void saveRelaySettings({ baseUrl: relayBaseUrl.value.trim() || DEFAULT_RELAY_BASE_URL });
    void refreshRelayStatus();
  });
  relayToken.addEventListener("blur", () => {
    void saveRelaySettings({ token: relayToken.value });
  });

  btnRelayCopyCmd.addEventListener("click", () => {
    void (async () => {
      const ok = await copyToClipboard(RELAY_START_COMMAND_SNIPPET);
      if (ok) {
        relayStatus.textContent = "Copied — edit the cd path to your clone, run in Terminal, then Refresh status.";
        relayStatus.className = "relay-status ok";
      } else {
        relayStatus.textContent = "Could not copy to clipboard.";
        relayStatus.className = "relay-status err";
      }
    })();
  });

  btnRelayTest.addEventListener("click", () => {
    void refreshRelayStatus();
  });

  void refreshRelayStatus();
}

void initRelayPanel();
void load();
