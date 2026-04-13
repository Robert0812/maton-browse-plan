import { fetchHistoryAsTraceEvents } from "./history-import.js";
import { buildIntentCluster } from "./intent-cluster-heuristic.js";
import { buildMatonBrowseDerivedPlan, type MatonPlanSiteInput } from "./maton-plan.js";
import { mergeHistoryAndLive } from "./merge-events.js";
import { replaceHistoryStore } from "./replace-history-store.js";
import {
  DEFAULT_RELAY_BASE_URL,
  loadRelaySettings,
  postRelayIngest,
} from "./relay-client.js";
import { sanitizeBatch } from "./sanitize.js";
import { EVENTS_LIVE_KEY } from "./storage-keys.js";
import type { CapturePayload, CapturePreset, TraceEvent } from "./types.js";

const TOP_SITES = 10;

function sitesToPlanInputs(sites: ReturnType<typeof buildIntentCluster>["sites"]): MatonPlanSiteInput[] {
  return sites.slice(0, TOP_SITES).map((s) => ({
    rank: s.rank,
    origin: s.origin,
    siteUrl: s.siteUrl,
    functions: s.functions.map((f) => ({ resourceUrl: f.resourceUrl })),
  }));
}

/**
 * Re-import Chrome history for `historyPreset`, replace the history partition, merge with live events,
 * build matonPlan, POST to the local relay. Caller must have started the relay already.
 */
export async function runHistoryRescanAndRelayIngest(
  historyPreset: CapturePreset,
): Promise<{ ok: boolean; detail?: string; eventCount: number; skipped: number; siteCount: number }> {
  const { events: histEvents, skipped } = await fetchHistoryAsTraceEvents(historyPreset);
  await replaceHistoryStore(histEvents);
  const { [EVENTS_LIVE_KEY]: liveRaw } = await chrome.storage.local.get(EVENTS_LIVE_KEY);
  const liveEvents: TraceEvent[] = Array.isArray(liveRaw) ? liveRaw : [];
  const merged = mergeHistoryAndLive(histEvents, liveEvents);
  const sanitized = sanitizeBatch(merged);
  const { sites } = buildIntentCluster(sanitized);
  const planSites = sitesToPlanInputs(sites);
  const exportedAt = new Date().toISOString();
  const matonPlan = buildMatonBrowseDerivedPlan(planSites, exportedAt, historyPreset);
  const payload: CapturePayload = {
    preset: historyPreset,
    events: sanitized,
    exportedAt,
    matonPlan,
  };
  const relayCfg = await loadRelaySettings();
  const baseUrl = relayCfg.baseUrl.trim() || DEFAULT_RELAY_BASE_URL;
  const ing = await postRelayIngest(baseUrl, relayCfg.token.trim() || undefined, payload);
  if (!ing.ok) {
    return {
      ok: false,
      detail: ing.detail,
      eventCount: merged.length,
      skipped,
      siteCount: planSites.length,
    };
  }
  return {
    ok: true,
    eventCount: merged.length,
    skipped,
    siteCount: planSites.length,
  };
}
