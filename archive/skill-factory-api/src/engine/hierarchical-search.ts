import type { GoldenPath, HarnessTier } from "@skill-factory/shared";
import { randomUUID } from "node:crypto";

export interface SearchParams {
  goal: string;
  allowlist: string[];
  traceHints?: unknown;
}

async function tryTier(
  tier: HarnessTier,
  params: SearchParams,
): Promise<GoldenPath | null> {
  if (!params.goal) return null;

  if (tier === "P0_parametric") {
    return {
      id: randomUUID(),
      goalId: params.goal,
      skillId: "pending",
      stabilityScore: 0.42,
      steps: [
        {
          tier: "P0_parametric",
          description: "Construct URL from history-derived template (placeholder).",
          spec: { template: "{origin}/search?q={query}" },
        },
      ],
      provenance: { discoveredAt: new Date().toISOString(), sourceTier: "P0_parametric" },
    };
  }

  if (tier === "P1_scripted") {
    return {
      id: randomUUID(),
      goalId: params.goal,
      skillId: "pending",
      stabilityScore: 0.58,
      steps: [
        {
          tier: "P1_scripted",
          description: "Playwright path discovered from DOM signals (placeholder).",
          spec: { actions: [] },
        },
      ],
      provenance: { discoveredAt: new Date().toISOString(), sourceTier: "P1_scripted" },
    };
  }

  return {
    id: randomUUID(),
    goalId: params.goal,
    skillId: "pending",
    stabilityScore: 0.35,
    steps: [
      {
        tier: "P2_visual",
        description: "SoM / CV fallback to re-anchor navigation (placeholder).",
        spec: { visualGoal: params.goal },
      },
    ],
    provenance: { discoveredAt: new Date().toISOString(), sourceTier: "P2_visual" },
  };
}

/** Prefer P0, then P1, then P2. Production: score and merge candidates, not first-hit only. */
export async function searchTrajectories(params: SearchParams): Promise<GoldenPath[]> {
  if (!params.goal.trim()) return [];
  const hints = params.traceHints as { origins?: string[] } | undefined;
  const origins = hints?.origins ?? [];
  if (params.allowlist.length && origins.length) {
    const allowed = origins.some((o) =>
      params.allowlist.some((rule) => o === rule || o.endsWith(`.${rule}`) || o.includes(rule)),
    );
    if (!allowed) return [];
  }
  for (const tier of ["P0_parametric", "P1_scripted", "P2_visual"] as const) {
    const path = await tryTier(tier, params);
    if (path) return [path];
  }
  return [];
}
