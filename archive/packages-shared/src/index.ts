/** Six-phase trust pipeline (product workflow). */
export type PipelinePhase =
  | "capture"
  | "permission_gate"
  | "intent_validation"
  | "exploration"
  | "export"
  | "integration";

/** Hierarchical harness priority for trajectory search. */
export type HarnessTier = "P0_parametric" | "P1_scripted" | "P2_visual";

export interface TraceEvent {
  url: string;
  origin: string;
  path: string;
  dwellMs: number;
  capturedAt: string;
  /** Live recording vs Chrome history backfill (extension / importers). */
  source?: "live" | "history";
  /** Title from history API when source is history. */
  title?: string;
  /** Chrome history visitCount when source is history. */
  visitCount?: number;
  transition?:
    | "navigation"
    | "visibility"
    | "tab_switch"
    | "tab_close"
    | "capture_stop"
    | "history_import";
}

/** Server-side roll-up after Phase 1 ingest (extension may pre-filter “private” origins). */
export interface CaptureIngestionSummary {
  eventCount: number;
  historyCount: number;
  liveCount: number;
  otherCount: number;
  uniqueOrigins: string[];
  /** Rows dropped because they failed minimal validation. */
  droppedInvalid: number;
}

export interface CaptureSession {
  id: string;
  userId: string;
  startedAt: string;
  endedAt?: string;
  /** User-chosen window, e.g. 1h – 30d */
  window: { preset: "1h" | "24h" | "7d" | "30d" | "custom"; customHours?: number };
  events: TraceEvent[];
  /**
   * ISO timestamp from the extension review page when the user sent or finalized export
   * (matches downloaded JSON `exportedAt` when provided).
   */
  clientExportedAt?: string;
  /** Computed at ingest; drives later phases (exploration hints, allowlists). */
  ingestion?: CaptureIngestionSummary;
}

export interface RedactedDomain {
  hostname: string;
  reason?: string;
}

export interface PermissionGateState {
  sessionId: string;
  /** Domains the user explicitly allows automation against */
  allowlist: string[];
  /** Domains redacted at the gate (never leave device / never used in downstream phases) */
  blocklist: RedactedDomain[];
}

export interface CandidateSkill {
  id: string;
  title: string;
  summary: string;
  /** Representative origins from clustering */
  origins: string[];
  suggestedTools: string[];
}

/**
 * Phase 3 — one plausible automation “function” derived from history/live (or external doc URL).
 */
export interface SuggestedSiteFunction {
  name: string;
  description: string;
  /**
   * Concrete URL from the user’s trace when available; otherwise API docs, CLI reference,
   * or another canonical endpoint the harness could call.
   */
  resourceUrl: string;
}

/**
 * Phase 3 — one clustered site the user appears to care about, with up to three function ideas.
 */
export interface ClusteredInterestSite {
  /** 1-based rank by interest score (higher = more weight from visits/dwell) */
  rank: number;
  /** Representative URL (typically a concrete page from history for this origin) */
  siteUrl: string;
  origin: string;
  /** Why this site ranked highly (LLM summary or heuristic caption). */
  summary: string;
  /** Compact engagement stats (history visit sum, row counts, score) for harness / LLM context. */
  interestStats?: string;
  /** At most three suggested functions (enforced server-side). */
  functions: SuggestedSiteFunction[];
}

export interface IntentClusterResult {
  /** Heuristic clustering only (visitCount, dwellMs, path+query patterns). */
  source: "heuristic";
  sites: ClusteredInterestSite[];
}

export interface IntentValidationState {
  sessionId: string;
  selectedSkillIds: string[];
  refinements: Record<string, string>;
}

export interface TrajectoryStep {
  tier: HarnessTier;
  description: string;
  /** P0: templated URL; P1: selector/action DSL; P2: visual goal spec */
  spec: Record<string, unknown>;
}

export interface GoldenPath {
  id: string;
  goalId: string;
  skillId: string;
  stabilityScore: number;
  steps: TrajectoryStep[];
  provenance: { discoveredAt: string; sourceTier: HarnessTier };
}

export interface McpSkillBundle {
  skillId: string;
  name: string;
  version: string;
  goldenPathIds: string[];
  /** Serialized for MCP `tools/list` + handler routing */
  toolSchemas: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
}

export interface DeploymentTicket {
  bundleId: string;
  /** Temporary public URL for agent install (Living Skill endpoint) */
  installUrl: string;
  expiresAt: string;
}

/** Phase 4 — how a function might be reached in automation. */
export type HarnessAccessPath = "skill" | "cli" | "api" | "gap";

/** A concrete tool/page discovered when reasoning from catalog surfaces (not the catalog homepage alone). */
export interface HarnessDiscoveryMatch {
  title: string;
  /** Listing page, repo, package URL, or API doc — specific, not only skillhub.cn / clawhub.ai roots */
  url: string;
  /** Which discovery surface informed this match */
  discoveredVia: "skillhub.cn" | "clawhub.ai" | "github.com" | "opencli" | "site_api_docs";
}

/** Per suggested function: skills / CLI / API recommendation from exploration. */
export interface FunctionHarnessPlan {
  functionName: string;
  resourceUrl: string;
  coverable: boolean;
  recommendedPath: HarnessAccessPath;
  /** 0–1 qualitative confidence */
  reliability: number;
  /** 0–1 speed / friction */
  efficiency: number;
  costNote: string;
  /** @deprecated Prefer skillMatches — search phrases for skillhub.cn */
  skillhubSearch?: string;
  /** @deprecated Prefer skillMatches — search phrases for clawhub.ai */
  clawhubSearch?: string;
  /** Specific skills/pages inferred from searching skillhub.cn / clawhub.ai */
  skillMatches?: HarnessDiscoveryMatch[];
  /** CLIs/repos/packages inferred from github.com / jackwener/opencli */
  cliMatches?: HarnessDiscoveryMatch[];
  /** Public API docs or endpoint references for the origin */
  apiDocMatches?: Array<{ title: string; url: string }>;
  /** e.g. gh repo, opencli entry, or install hint */
  cliHint?: string;
  /** Documented free/public endpoint or doc URL */
  apiHint?: string;
  instructionalPrompt: string;
}

export interface HarnessInstallerCron {
  origin: string;
  rationale: string;
  cronExpression: string;
  scheduleSummary: string;
}

/** Per-origin install steps and function plans (no capture statistics or Phase 3 captions). */
export interface HarnessInstallerSite {
  origin: string;
  rank: number;
  setupSteps: string[];
  plans: FunctionHarnessPlan[];
}

/**
 * Phase 4 published installer — only `sites` (per-origin plans) and `cronSuggestions`.
 * No prompt snippets or capture statistics.
 */
export interface HarnessInstallerSpec {
  generatedAt: string;
  sites: HarnessInstallerSite[];
  cronSuggestions: HarnessInstallerCron[];
}
