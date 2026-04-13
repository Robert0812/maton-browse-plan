import type { TraceEvent } from "@skill-factory/shared";

export interface OriginVisitStats {
  origin: string;
  eventCount: number;
  historyCount: number;
  liveCount: number;
  /** Sum of Chrome history visitCount for history rows (same origin bucket) */
  historyVisitSum: number;
  firstSeen: string;
  lastSeen: string;
  medianGapMs?: number;
  /** Rough average visits per 24h window spanned by trace */
  visitsPerDayApprox?: number;
}

function median(sorted: number[]): number | undefined {
  if (sorted.length === 0) return undefined;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Aggregate capture rows for Phase 4 cron / timing hints. */
export function computeOriginVisitStats(events: TraceEvent[]): OriginVisitStats[] {
  const byOrigin = new Map<string, TraceEvent[]>();
  for (const e of events) {
    const o = e.origin;
    if (!o) continue;
    let arr = byOrigin.get(o);
    if (!arr) {
      arr = [];
      byOrigin.set(o, arr);
    }
    arr.push(e);
  }

  const out: OriginVisitStats[] = [];
  for (const [origin, evs] of byOrigin) {
    const sorted = [...evs].sort(
      (a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
    );
    const times = sorted.map((e) => new Date(e.capturedAt).getTime());
    const gaps: number[] = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i]! - times[i - 1]!);
    const medGap = gaps.length ? median([...gaps].sort((a, b) => a - b)) : undefined;

    const spanMs = times.length >= 2 ? times[times.length - 1]! - times[0]! : 0;
    const days = spanMs > 0 ? spanMs / (86_400_000) : 1;
    const visitsPerDayApprox = days > 0 ? sorted.length / days : sorted.length;

    let historyCount = 0;
    let liveCount = 0;
    let historyVisitSum = 0;
    for (const e of sorted) {
      if (e.source === "history") {
        historyCount++;
        historyVisitSum += e.visitCount ?? 1;
      } else if (e.source === "live") liveCount++;
    }

    out.push({
      origin,
      eventCount: sorted.length,
      historyCount,
      liveCount,
      historyVisitSum,
      firstSeen: sorted[0]!.capturedAt,
      lastSeen: sorted[sorted.length - 1]!.capturedAt,
      medianGapMs: medGap,
      visitsPerDayApprox: Math.round(visitsPerDayApprox * 100) / 100,
    });
  }

  return out.sort((a, b) => b.eventCount - a.eventCount);
}

export function formatVisitStatsForPrompt(stats: OriginVisitStats[]): string {
  if (!stats.length) return "No per-origin visit stats.";
  return stats
    .map(
      (s) =>
        `- ${s.origin}: ${s.eventCount} capture rows (${s.historyCount} history Σvisits≈${s.historyVisitSum}, ${s.liveCount} live), ` +
        `first ${s.firstSeen}, last ${s.lastSeen}` +
        (s.medianGapMs != null
          ? `, median gap ${Math.round(s.medianGapMs / 3_600_000) / 10}h`
          : "") +
        (s.visitsPerDayApprox != null ? `, ~${s.visitsPerDayApprox}/day` : ""),
    )
    .join("\n");
}

/** Compact per-origin lines for Phase 4 LLM cron timing only (no full capture enumeration). */
export function formatCronHintsForLlm(stats: OriginVisitStats[]): string {
  if (!stats.length) return "(no timing hints)";
  return stats
    .map((s) => {
      const rate = s.visitsPerDayApprox != null ? `~${s.visitsPerDayApprox}/day` : "rate n/a";
      return `- ${s.origin}: ${rate}`;
    })
    .join("\n");
}
