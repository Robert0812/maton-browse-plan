/**
 * Heuristic intent clustering for the review page Phase 3 (local, no server).
 */
import type { TraceEvent } from "./types.js";

export interface SuggestedSiteFunction {
  name: string;
  description: string;
  resourceUrl: string;
}

export interface ClusteredInterestSite {
  rank: number;
  siteUrl: string;
  origin: string;
  summary: string;
  interestStats?: string;
  functions: SuggestedSiteFunction[];
}

export interface IntentClusterResult {
  source: "heuristic";
  sites: ClusteredInterestSite[];
}

const MAX_ORIGINS = 10;
const MAX_FUNCTIONS_PER_ORIGIN = 3;

interface OriginBucket {
  origin: string;
  score: number;
  events: TraceEvent[];
}

interface QueryBucket {
  path: string;
  searchNormalized: string;
  events: TraceEvent[];
}

function bucketByOrigin(events: TraceEvent[]): OriginBucket[] {
  const map = new Map<string, OriginBucket>();
  for (const e of events) {
    let b = map.get(e.origin);
    if (!b) {
      b = { origin: e.origin, score: 0, events: [] };
      map.set(e.origin, b);
    }
    b.events.push(e);
    if (e.source === "history") b.score += (e.visitCount ?? 1) * 4 + 2;
    else if (e.source === "live") b.score += Math.min(e.dwellMs, 600_000) / 3000 + 3;
    else b.score += 2;
  }
  const filtered = [...map.values()].filter(originPassesInterestGate);
  return filtered.sort((a, b) => b.score - a.score).slice(0, MAX_ORIGINS);
}

function originPassesInterestGate(b: OriginBucket): boolean {
  const history = b.events.filter((e) => e.source === "history");
  const live = b.events.filter((e) => e.source === "live");
  const historyVisitSum = history.reduce((s, e) => s + (e.visitCount ?? 1), 0);
  const liveDwellSum = live.reduce((s, e) => s + Math.min(e.dwellMs ?? 0, 600_000), 0);
  if (b.events.length >= 2) return true;
  if (historyVisitSum >= 2) return true;
  if (liveDwellSum >= 10_000) return true;
  return false;
}

function formatInterestStats(b: OriginBucket): string {
  const history = b.events.filter((e) => e.source === "history");
  const live = b.events.filter((e) => e.source === "live");
  const historyVisitSum = history.reduce((s, e) => s + (e.visitCount ?? 1), 0);
  return [
    `historyVisitSum≈${historyVisitSum}`,
    `rows=${b.events.length} (${history.length} history / ${live.length} live)`,
    `score≈${Math.round(b.score * 10) / 10}`,
  ].join("; ");
}

function isHistoryQueryBearing(e: TraceEvent): boolean {
  if (e.source !== "history") return false;
  try {
    const u = new URL(e.url);
    if (u.search.length <= 1) return false;
    return [...new URLSearchParams(u.search).keys()].length > 0;
  } catch {
    return false;
  }
}

function partitionQueryBuckets(originEvents: TraceEvent[]): QueryBucket[] {
  const map = new Map<string, QueryBucket>();
  for (const e of originEvents) {
    let path = e.path && e.path !== "" ? e.path : "/";
    let searchNorm = "";
    try {
      const u = new URL(e.url);
      path = u.pathname || "/";
      if (u.search.length > 1) {
        const sp = new URLSearchParams(u.search);
        searchNorm = [...sp.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join("&");
      }
    } catch {
      /* keep event path */
    }
    const key = searchNorm ? `${path}\0${searchNorm}` : `${path}\0`;
    let qb = map.get(key);
    if (!qb) {
      qb = { path, searchNormalized: searchNorm, events: [] };
      map.set(key, qb);
    }
    qb.events.push(e);
  }
  return [...map.values()];
}

function scoreQueryBucket(evs: TraceEvent[]): number {
  return evs.reduce((s, e) => {
    if (e.source === "history") return s + (e.visitCount ?? 1) * 3 + 2;
    if (e.source === "live") return s + Math.min(e.dwellMs, 600_000) / 3500 + 2;
    return s + 2;
  }, 0);
}

function truncate(s: string, n: number): string {
  const t = s.trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n - 1)}…`;
}

function safeDecodeParam(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

function pathLabel(path: string): string {
  if (path === "/" || path === "") return "Home / landing";
  const parts = path.split("/").filter(Boolean);
  const seg = parts[0] ?? "page";
  const words = seg.replace(/[-_]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return words.replace(/\b\w/g, (c) => c.toUpperCase());
}

function nameFromQuery(path: string, searchNorm: string): string {
  if (!searchNorm) return pathLabel(path);
  const sp = new URLSearchParams(searchNorm);
  const searchKeys = ["q", "query", "search", "text", "p", "keywords"];
  for (const k of searchKeys) {
    const v = sp.get(k);
    if (v) return `Search (“${truncate(safeDecodeParam(v), 40)}”)`;
  }
  const id = sp.get("id") ?? sp.get("v") ?? sp.get("video") ?? sp.get("item");
  if (id) return `Open item (${truncate(safeDecodeParam(id), 24)})`;
  const tab = sp.get("tab") ?? sp.get("page") ?? sp.get("view");
  if (tab) return `View (“${truncate(safeDecodeParam(tab), 32)}”)`;
  const keys = [...sp.keys()].slice(0, 5);
  if (keys.length) return `Params: ${keys.join(", ")}`;
  return pathLabel(path);
}

function describeFromQuery(path: string, searchNorm: string, evs: TraceEvent[]): string {
  const parts: string[] = [];
  parts.push(`Path ${path || "/"}.`);
  if (searchNorm) {
    const sp = new URLSearchParams(searchNorm);
    const summary = [...sp.entries()]
      .slice(0, 6)
      .map(([k, v]) => `${k}=${truncate(safeDecodeParam(v), 48)}`)
      .join("; ");
    parts.push(`Query: ${summary}.`);
  }
  const titles = [...new Set(evs.map((e) => e.title).filter(Boolean))] as string[];
  if (titles.length) parts.push(`Titles: ${titles.slice(0, 2).join(" · ")}.`);
  const hist = evs.filter((e) => e.source === "history").length;
  const live = evs.filter((e) => e.source === "live").length;
  parts.push(`Signals: ${hist} history row(s), ${live} live row(s).`);
  return parts.join(" ");
}

function pickResourceUrl(evs: TraceEvent[]): string {
  const sorted = [...evs].sort((a, b) => {
    const ql =
      (() => {
        try {
          return new URL(b.url).search.length;
        } catch {
          return 0;
        }
      })() -
      (() => {
        try {
          return new URL(a.url).search.length;
        } catch {
          return 0;
        }
      })();
    if (ql !== 0) return ql;
    const t = (b.title?.length ?? 0) - (a.title?.length ?? 0);
    if (t !== 0) return t;
    return new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime();
  });
  return sorted[0]?.url ?? evs[0]!.url;
}

function buildFunctionsForOrigin(originEvents: TraceEvent[]): SuggestedSiteFunction[] {
  const historyQuery = originEvents.filter(isHistoryQueryBearing);
  if (historyQuery.length === 0) return [];

  const buckets = partitionQueryBuckets(historyQuery).filter((qb) => qb.searchNormalized.length > 0);
  if (buckets.length === 0) return [];

  const ranked = buckets
    .map((qb) => ({ qb, w: scoreQueryBucket(qb.events) }))
    .sort((a, b) => b.w - a.w)
    .map((x) => x.qb)
    .slice(0, MAX_FUNCTIONS_PER_ORIGIN);

  return ranked.map((qb) => ({
    name: nameFromQuery(qb.path, qb.searchNormalized),
    description: describeFromQuery(qb.path, qb.searchNormalized, qb.events),
    resourceUrl: pickResourceUrl(qb.events),
  }));
}

function siteUrlForOriginBucket(b: OriginBucket): string {
  const historyQuery = b.events.filter(isHistoryQueryBearing);
  if (historyQuery.length > 0) {
    const buckets = partitionQueryBuckets(historyQuery).filter((qb) => qb.searchNormalized.length > 0);
    const ranked = buckets
      .map((qb) => ({ qb, w: scoreQueryBucket(qb.events) }))
      .sort((x, y) => y.w - x.w);
    if (ranked[0]) return pickResourceUrl(ranked[0].qb.events);
  }
  return pickResourceUrl(b.events);
}

export function heuristicClusterFromEvents(events: TraceEvent[]): ClusteredInterestSite[] {
  if (events.length === 0) return [];
  const originBuckets = bucketByOrigin(events);
  return originBuckets.map((b, i) => {
    const functions = buildFunctionsForOrigin(b.events);
    const interestStats = formatInterestStats(b);
    return {
      rank: i + 1,
      origin: b.origin,
      siteUrl: siteUrlForOriginBucket(b),
      interestStats,
      summary:
        functions.length > 0
          ? `Rank #${i + 1} (${interestStats}). ${functions.length} interested function(s) from query-bearing history (cap ${MAX_FUNCTIONS_PER_ORIGIN}).`
          : `Rank #${i + 1} (${interestStats}). No query-bearing history for this origin — interested functions omitted.`,
      functions,
    };
  });
}

export function buildIntentCluster(events: TraceEvent[]): IntentClusterResult {
  return { source: "heuristic", sites: heuristicClusterFromEvents(events) };
}
