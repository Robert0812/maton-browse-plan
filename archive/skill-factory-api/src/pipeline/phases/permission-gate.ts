import type { PermissionGateState } from "@skill-factory/shared";
import { getCaptureSession } from "../session-store.js";
import { patchMvpContext } from "../mvp-pipeline-context.js";

/**
 * Phase 2 — allow/block lists for downstream exploration.
 * MVP: if `allowlist` is omitted and `sessionId` matches a capture session, allowlist defaults to captured unique origins.
 */
export async function phasePermissionGate(
  input: Record<string, unknown>,
): Promise<{ gate: PermissionGateState; note: string }> {
  const sessionId = String(input.sessionId ?? "").trim();
  let allowlist = Array.isArray(input.allowlist) ? (input.allowlist as unknown[]).map(String) : [];
  const blocklist = (input.blocklist as PermissionGateState["blocklist"]) ?? [];

  if (sessionId && allowlist.length === 0) {
    const cap = getCaptureSession(sessionId);
    const origins = cap?.ingestion?.uniqueOrigins ?? [];
    allowlist = [...origins];
  }

  const gate: PermissionGateState = { sessionId, allowlist, blocklist };
  if (sessionId) patchMvpContext(sessionId, { gate });

  return {
    gate,
    note: "MVP: gate saved in memory; empty allowlist + sessionId → all captured origins allowed.",
  };
}
