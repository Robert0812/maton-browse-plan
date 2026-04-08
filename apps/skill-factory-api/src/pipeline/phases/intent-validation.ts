import type { CandidateSkill, ClusteredInterestSite, IntentClusterResult, IntentValidationState } from "@skill-factory/shared";
import { randomUUID } from "node:crypto";
import { buildIntentCluster } from "../../intent/heuristic-cluster.js";
import { getCaptureSession } from "../session-store.js";
import { patchMvpContext } from "../mvp-pipeline-context.js";

function clusterSitesToCandidates(sites: ClusteredInterestSite[]): CandidateSkill[] {
  return sites.map((site) => {
    let host = site.origin;
    try {
      host = new URL(site.siteUrl).hostname;
    } catch {
      try {
        host = new URL(site.origin).hostname;
      } catch {
        /* keep origin string */
      }
    }
    return {
      id: randomUUID(),
      title: `${host} — clustered interests`,
      summary: site.summary,
      origins: [site.origin].filter(Boolean),
      suggestedTools: site.functions.map((f) => f.name),
    };
  });
}

/**
 * Phase 3 — heuristic clustering: top 10 origins (visitCount + dwellMs), up to 3 functions per origin
 * from distinct path + **query string** patterns in each row’s URL.
 */
export async function phaseIntentValidation(
  input: Record<string, unknown>,
): Promise<{
  cluster: IntentClusterResult;
  candidates: CandidateSkill[];
  validated: IntentValidationState;
  note: string;
}> {
  const sessionId = String(input.sessionId ?? "").trim();
  const selectedSkillIds = Array.isArray(input.selectedSkillIds)
    ? (input.selectedSkillIds as unknown[]).map(String)
    : [];
  const refinements = (input.refinements as IntentValidationState["refinements"]) ?? {};

  const cap = sessionId ? getCaptureSession(sessionId) : undefined;
  const events = cap?.events ?? [];

  const cluster = buildIntentCluster(events);

  const candidates = cluster.sites.length
    ? clusterSitesToCandidates(cluster.sites)
    : [
        {
          id: randomUUID(),
          title: "No traces to cluster",
          summary:
            "Run capture with a non-empty session (extension Send keeps ?query for API). Then POST intent_validation with sessionId.",
          origins: [] as string[],
          suggestedTools: [] as string[],
        },
      ];

  const validated: IntentValidationState = { sessionId, selectedSkillIds, refinements };
  if (sessionId) patchMvpContext(sessionId, { intent: validated, intentCluster: cluster });

  return {
    cluster,
    candidates,
    validated,
    note: "MVP: top 10 origins by history visit weight + live dwell; interested functions only from history rows with ?query (max 3 clusters), else functions [].",
  };
}
