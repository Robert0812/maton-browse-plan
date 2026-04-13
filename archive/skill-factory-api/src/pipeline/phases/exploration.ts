import type { GoldenPath, HarnessInstallerSpec } from "@skill-factory/shared";
import { buildHeuristicHarnessInstaller } from "../../exploration/heuristic-harness-fallback.js";
import { goldenPathsFromHarness, generateHarnessInstallerSpec } from "../../exploration/llm-harness.js";
import { publishHarnessInstaller } from "../../sync/harness-installer-store.js";
import { searchTrajectories } from "../../engine/hierarchical-search.js";
import { buildIntentCluster, capIntentClusterForExploration } from "../../intent/heuristic-cluster.js";
import { getCaptureSession } from "../session-store.js";
import { computeOriginVisitStats } from "../visit-patterns.js";
import { getMvpContext, patchMvpContext } from "../mvp-pipeline-context.js";

/** Phase 4 — exploration: stub golden paths + optional LLM harness installer from Phase 3 cluster (see below). */

/*
 * Implementation idea — for each Phase 3 top-interested origin:
 * - Extension finds skills at https://skillhub.cn/ or https://clawhub.ai/, CLIs via github.com or
 *   https://github.com/jackwener/opencli, and the origin’s free/public APIs when they exist.
 * - Decide whether top interested functions are coverable by public skills, CLIs, or free APIs.
 * - Choose the most reliable/efficient path per origin; the harness = that path plus code, skills, and
 *   instructional prompts.
 * - Extension calls an LLM to search for relevant skills/CLIs/APIs and pick an optimal path by
 *   estimating reliability, efficiency, and cost (third-party OpenAI-compatible API).
 * - Harness also includes cron instructions tied to those paths; trigger time/frequency mainly from
 *   visit time/frequency of the origins.
 * - Net output: a harness installer that injects agent system prompt/memory (preferences, optimal
 *   skills/CLIs/APIs, query-bearing URLs for direct function access), and guides the agent to set up
 *   skills/CLIs/APIs and cron jobs aligned with browsing history.
 * - Runtime: credentials from `OPENAI_*` env vars or optional local `api.md` (see `api.md.example`).
 */

export async function phaseExploration(input: Record<string, unknown>): Promise<{
  paths: GoldenPath[];
  harness: HarnessInstallerSpec | null;
  note: string;
  llm?: { used: boolean; error?: string; heuristicFallback?: boolean };
}> {
  const goal = String(input.goal ?? "");
  const sessionId = typeof input.sessionId === "string" ? input.sessionId.trim() : "";

  let allowlist = Array.isArray(input.allowlist) ? (input.allowlist as unknown[]).map(String) : [];
  if (sessionId && allowlist.length === 0) {
    const ctx = getMvpContext(sessionId);
    if (ctx?.gate?.allowlist?.length) allowlist = [...ctx.gate.allowlist];
    else {
      const cap = getCaptureSession(sessionId);
      allowlist = [...(cap?.ingestion?.uniqueOrigins ?? [])];
    }
  }

  let traceHints: unknown = input.traceHints;
  if (sessionId) {
    const session = getCaptureSession(sessionId);
    const fromCapture = session?.ingestion?.uniqueOrigins;
    if (fromCapture?.length) {
      const hintsObj =
        typeof traceHints === "object" && traceHints !== null && !Array.isArray(traceHints)
          ? { ...(traceHints as Record<string, unknown>) }
          : {};
      const prev = Array.isArray(hintsObj.origins)
        ? (hintsObj.origins as unknown[]).map((x) => String(x))
        : [];
      hintsObj.origins = [...new Set([...prev, ...fromCapture])];
      traceHints = hintsObj;
    }
  }

  const stubPaths = await searchTrajectories({ goal, allowlist, traceHints });

  let harness: HarnessInstallerSpec | null = null;
  let llm: { used: boolean; error?: string; heuristicFallback?: boolean } | undefined;
  let paths = stubPaths;

  const cap = sessionId ? getCaptureSession(sessionId) : undefined;
  const ctxCluster = sessionId ? getMvpContext(sessionId)?.intentCluster : undefined;
  const rawCluster =
    ctxCluster?.sites?.length ? ctxCluster : cap?.events?.length ? buildIntentCluster(cap.events) : undefined;
  const cluster = rawCluster ? capIntentClusterForExploration(rawCluster) : undefined;
  const events = cap?.events ?? [];

  if (cluster?.sites?.length) {
    const originOrder = cluster.sites.map((s) => s.origin);
    const rank = new Map(originOrder.map((o, i) => [o, i]));
    const visitStatsRaw = events.length ? computeOriginVisitStats(events) : [];
    const visitStats = visitStatsRaw
      .filter((v) => rank.has(v.origin))
      .sort((a, b) => (rank.get(a.origin) ?? 0) - (rank.get(b.origin) ?? 0));
    const { spec, error } = await generateHarnessInstallerSpec({ goal, cluster, visitStats });
    const rawHarness = spec ?? buildHeuristicHarnessInstaller(cluster, visitStats);
    llm = {
      used: true,
      heuristicFallback: !spec,
      ...(error ? { error } : {}),
    };
    const capUser = sessionId ? getCaptureSession(sessionId)?.userId : undefined;
    const published = publishHarnessInstaller(capUser ?? "chrome-extension", rawHarness);
    harness = published.harness;
    if (sessionId) patchMvpContext(sessionId, { lastHarness: harness });
    const fromHarness = goldenPathsFromHarness(harness);
    paths = [...fromHarness, ...stubPaths];
  } else {
    llm = { used: false, error: "No Phase 3 cluster: run intent_validation with sessionId or capture with ?query history." };
  }

  const note = harness
    ? llm?.heuristicFallback
      ? `Phase 4: heuristic harness published (LLM ${llm?.error ? "error: " + llm.error : "not configured"}). Golden paths + GET /v1/sync/harness-installer updated.`
      : "Phase 4: LLM harness published; golden paths from harness; GET /v1/sync/harness-installer updated."
    : llm?.error && llm.used
      ? `Phase 4: no harness — ${llm.error}`
      : stubPaths.length
        ? "Phase 4: MVP stub paths only (no cluster)."
        : "Phase 4: no paths (empty goal, allowlist/origin mismatch, or no cluster).";

  return { paths, harness, note, llm };
}

// OPENAI_API_KEY — third-party LLM access; must be encrypted / app-only at rest, never committed as plaintext.
// OPENAI_BASE_URL=https://api.apiyi.com/v1 — OpenAI-compatible base URL; same encryption / app-only policy as the key.
