import type { DeploymentTicket } from "@skill-factory/shared";
import { randomUUID } from "node:crypto";
import { getMvpContext } from "../mvp-pipeline-context.js";

/**
 * Phase 6 — synthetic install URL for demos.
 * MVP: bundleId from input, or last export for this sessionId.
 */
export async function phaseIntegration(
  input: Record<string, unknown>,
): Promise<{ ticket: DeploymentTicket; note: string }> {
  const sessionId = typeof input.sessionId === "string" ? input.sessionId.trim() : "";
  let bundleId = typeof input.bundleId === "string" && input.bundleId.trim() ? input.bundleId.trim() : "";

  if (!bundleId && sessionId) {
    const last = getMvpContext(sessionId)?.lastBundle;
    if (last?.skillId) bundleId = last.skillId;
  }
  if (!bundleId) bundleId = randomUUID();

  const base = process.env.PUBLIC_SKILL_BASE ?? "https://skills.example.invalid";
  const installUrl = `${base}/install/${bundleId}`;

  const ticket: DeploymentTicket = {
    bundleId,
    installUrl,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
  };

  return {
    ticket,
    note: "MVP: fake install URL; set PUBLIC_SKILL_BASE for display only.",
  };
}
