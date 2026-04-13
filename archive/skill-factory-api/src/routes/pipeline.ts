import type { FastifyInstance } from "fastify";
import { sanitizePipelineResultForClient } from "../pipeline/public-result.js";
import { runPhase } from "../pipeline/orchestrator.js";

export async function registerPipelineRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/pipeline/:phase", async (request, reply) => {
    const phase = request.params as { phase: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const out = await runPhase(phase.phase, body);
    if ("error" in out) {
      return reply.send(out);
    }
    return reply.send({
      phase: out.phase,
      result: sanitizePipelineResultForClient(out.phase, out.result),
    });
  });

  app.get("/v1/pipeline", async () => ({
    phases: [
      "capture",
      "permission_gate",
      "intent_validation",
      "exploration",
      "export",
      "integration",
    ],
    harnessTiers: ["P0_parametric", "P1_scripted", "P2_visual"],
  }));
}
