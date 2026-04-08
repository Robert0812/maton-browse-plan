import type { PipelinePhase } from "@skill-factory/shared";
import { phaseCapture } from "./phases/capture.js";
import { phasePermissionGate } from "./phases/permission-gate.js";
import { phaseIntentValidation } from "./phases/intent-validation.js";
import { phaseExploration } from "./phases/exploration.js";
import { phaseExport } from "./phases/export.js";
import { phaseIntegration } from "./phases/integration.js";

const handlers: Record<PipelinePhase, (input: Record<string, unknown>) => Promise<unknown>> = {
  capture: phaseCapture,
  permission_gate: phasePermissionGate,
  intent_validation: phaseIntentValidation,
  exploration: phaseExploration,
  export: phaseExport,
  integration: phaseIntegration,
};

const phaseSet = new Set<PipelinePhase>([
  "capture",
  "permission_gate",
  "intent_validation",
  "exploration",
  "export",
  "integration",
]);

export async function runPhase(
  rawPhase: string,
  input: Record<string, unknown>,
): Promise<{ phase: PipelinePhase; result: unknown } | { error: string }> {
  if (!phaseSet.has(rawPhase as PipelinePhase)) {
    return { error: `unknown phase: ${rawPhase}` };
  }
  const phase = rawPhase as PipelinePhase;
  const result = await handlers[phase](input);
  return { phase, result };
}
