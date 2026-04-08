import { skillFactoryApiBase } from "./config.js";
import { buildIntentCluster } from "./lib/intent-cluster-heuristic.js";
import { batchForCaptureApi, sanitizeBatch } from "./lib/sanitize.js";
import type { CapturePayload, CapturePreset, TraceEvent } from "./lib/types.js";

const statsEl = document.getElementById("stats") as HTMLDivElement;
const tbody = document.getElementById("tbody") as HTMLTableSectionElement;
const emptyState = document.getElementById("emptyState") as HTMLDivElement;
const intentPanel = document.getElementById("intentPanel") as HTMLElement;
const intentPanelBody = document.getElementById("intentPanelBody") as HTMLDivElement;
const exportPreset = document.getElementById("exportPreset") as HTMLSelectElement;
const btnSend = document.getElementById("btnSend") as HTMLButtonElement;
const btnDownload = document.getElementById("btnDownload") as HTMLButtonElement;
const result = document.getElementById("result") as HTMLPreElement;

const MAX_ROWS = 200;

let rawEvents: TraceEvent[] = [];
let liveCount = 0;
let historyCount = 0;
/** Origins omitted from Send / Download when checked. */
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

/** Send payload: same exclusions as review table, queries preserved for server-side intent clustering. */
function getFilteredEventsForApiSend(): TraceEvent[] {
  return batchForCaptureApi(rawEvents).filter((ev) => !excludedOrigins.has(ev.origin));
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

/** Local Phase 3 for a concrete event list (used after Send with the payload that was posted). */
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
  btnSend.disabled = !canExport;
  btnDownload.disabled = !canExport;
  hideIntentPanel();
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
    cb.title = `Exclude ${ev.origin} from Send and Download`;
    cb.setAttribute("aria-label", `Exclude origin ${ev.origin} from Send and Download`);
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
  return {
    preset: exportPreset.value as CapturePreset,
    events: getFilteredEvents(),
    exportedAt: new Date().toISOString(),
  };
}

btnDownload.addEventListener("click", () => {
  if (rawEvents.length === 0 || exportEventCount() === 0) return;
  const payload = buildPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `skill-factory-capture-${payload.exportedAt.slice(0, 19)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showResult("Download started.");
});

btnSend.addEventListener("click", async () => {
  if (rawEvents.length === 0 || exportEventCount() === 0) return;
  const preset = exportPreset.value as CapturePreset;
  const events = getFilteredEventsForApiSend();
  const base = skillFactoryApiBase();
  const captureUrl = `${base}/v1/pipeline/capture`;
  btnSend.disabled = true;
  try {
    const r = await fetch(captureUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "chrome-extension",
        window: { preset },
        exportedAt: new Date().toISOString(),
        events,
      }),
    });
    const text = await r.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    showResult(JSON.stringify({ ok: r.ok, status: r.status, body: json }, null, 2));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showResult(
      [
        `Request failed: ${msg}`,
        `URL: ${captureUrl}`,
        'If this is "Failed to fetch": start the API (`node apps/skill-factory-api/dist/index.js`), ensure the port matches `src/config.ts`, then reload this extension on chrome://extensions.',
        "Private-network preflight: API must return Access-Control-Allow-Private-Network (rebuild API after pull).",
      ].join("\n"),
    );
  } finally {
    updateExportDependentUi();
    showIntentClusterForEvents(events);
  }
});

void load();
