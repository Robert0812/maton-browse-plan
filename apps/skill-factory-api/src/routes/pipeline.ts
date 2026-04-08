import type { FastifyInstance } from "fastify";
import { runPhase } from "../pipeline/orchestrator.js";

export async function registerPipelineRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/pipeline/:phase", async (request, reply) => {
    const phase = request.params as { phase: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const result = await runPhase(phase.phase, body);
    return reply.send(result);
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
