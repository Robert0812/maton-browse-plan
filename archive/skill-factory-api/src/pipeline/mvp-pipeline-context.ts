import type {
  GoldenPath,
  HarnessInstallerSpec,
  IntentClusterResult,
  IntentValidationState,
  McpSkillBundle,
  PermissionGateState,
} from "@skill-factory/shared";

/** MVP: holds per-session pipeline state in memory (lost on process exit). */
export interface MvpPipelineContext {
  gate?: PermissionGateState;
  intent?: IntentValidationState;
  /** Phase 3 clustering output (sites + suggested functions). */
  intentCluster?: IntentClusterResult;
  /** Phase 4 — LLM harness installer (last successful exploration). */
  lastHarness?: HarnessInstallerSpec;
  lastPaths?: GoldenPath[];
  lastBundle?: McpSkillBundle;
}

const bySession = new Map<string, MvpPipelineContext>();

export function getMvpContext(sessionId: string): MvpPipelineContext | undefined {
  if (!sessionId) return undefined;
  return bySession.get(sessionId);
}

export function ensureMvpContext(sessionId: string): MvpPipelineContext {
  let ctx = bySession.get(sessionId);
  if (!ctx) {
    ctx = {};
    bySession.set(sessionId, ctx);
  }
  return ctx;
}

export function patchMvpContext(sessionId: string, patch: Partial<MvpPipelineContext>): MvpPipelineContext {
  const ctx = ensureMvpContext(sessionId);
  Object.assign(ctx, patch);
  return ctx;
}
