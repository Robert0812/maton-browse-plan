import type { GoldenPath, McpSkillBundle } from "@skill-factory/shared";
import { randomUUID } from "node:crypto";
import { patchMvpContext } from "../mvp-pipeline-context.js";

/**
 * Phase 5 — MCP bundle from golden paths.
 * MVP: optional sessionId links bundle + paths into mvp context for integration.
 */
export async function phaseExport(
  input: Record<string, unknown>,
): Promise<{ bundle: McpSkillBundle; note: string }> {
  const paths = Array.isArray(input.paths) ? (input.paths as GoldenPath[]) : [];
  const skillId = String(input.skillId ?? randomUUID());
  const sessionId = typeof input.sessionId === "string" ? input.sessionId.trim() : "";

  const bundle: McpSkillBundle = {
    skillId,
    name: String(input.name ?? `skill-${skillId.slice(0, 8)}`),
    version: "0.1.0",
    goldenPathIds: paths.map((p) => p.id),
    toolSchemas: [
      {
        name: "execute_skill",
        description: "MVP: runs the bundled golden path stub.",
        inputSchema: { type: "object", properties: { args: { type: "object" } }, required: [] },
      },
    ],
  };

  if (sessionId) patchMvpContext(sessionId, { lastPaths: paths, lastBundle: bundle });

  return {
    bundle,
    note: "MVP: bundle manifest only; pass sessionId to chain to integration.",
  };
}
