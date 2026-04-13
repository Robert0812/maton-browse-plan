import type { HarnessInstallerSpec, IntentClusterResult } from "@skill-factory/shared";
import type { OriginVisitStats } from "../pipeline/visit-patterns.js";

/**
 * When Phase 4 LLM is unavailable, still publish an installer so GET /v1/sync/harness-installer works.
 * Shape matches published contract: only `sites` + `cronSuggestions` (no prompts or stats).
 */
export function buildHeuristicHarnessInstaller(
  cluster: IntentClusterResult,
  visitStats: OriginVisitStats[],
): HarnessInstallerSpec {
  const generatedAt = new Date().toISOString();
  const sites = cluster.sites.map((s) => ({
    origin: s.origin,
    rank: s.rank,
    setupSteps: [`Open: ${s.siteUrl}`],
    plans: s.functions.map((f) => ({
      functionName: f.name,
      resourceUrl: f.resourceUrl,
      coverable: false,
      recommendedPath: "gap" as const,
      reliability: 0.35,
      efficiency: 0.45,
      costNote: "heuristic-only (no LLM)",
      instructionalPrompt: `${f.description}\nOpen: ${f.resourceUrl}`,
    })),
  }));

  const byOrigin = new Map(visitStats.map((v) => [v.origin, v]));
  const cronSuggestions = cluster.sites.slice(0, 8).map((s) => {
    const v = byOrigin.get(s.origin);
    const daily = v?.visitsPerDayApprox != null && v.visitsPerDayApprox >= 1;
    return {
      origin: s.origin,
      rationale: "",
      cronExpression: daily ? "0 */6 * * *" : "0 9 * * *",
      scheduleSummary: daily ? "Every 6 hours" : "Daily 09:00",
    };
  });

  return {
    generatedAt,
    sites,
    cronSuggestions,
  };
}
