import type { FastifyInstance } from "fastify";
import type { HarnessInstallerCron, HarnessInstallerSite, HarnessInstallerSpec } from "@skill-factory/shared";
import { getPublishedHarness, publishHarnessInstaller } from "../sync/harness-installer-store.js";

/** Accepts `{ generatedAt, sites, cronSuggestions }` or legacy `{ harness: { sites } }` POST bodies. */
function normalizeHarnessInput(raw: unknown): HarnessInstallerSpec | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.generatedAt !== "string") return null;
  const cronSuggestions = Array.isArray(o.cronSuggestions) ? (o.cronSuggestions as HarnessInstallerCron[]) : [];
  if (Array.isArray(o.sites)) {
    return {
      generatedAt: o.generatedAt,
      sites: o.sites as HarnessInstallerSite[],
      cronSuggestions,
    };
  }
  if (o.harness && typeof o.harness === "object") {
    const sites = (o.harness as Record<string, unknown>).sites;
    if (!Array.isArray(sites)) return null;
    return {
      generatedAt: o.generatedAt,
      sites: sites as HarnessInstallerSite[],
      cronSuggestions,
    };
  }
  return null;
}

export async function registerHarnessSyncRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/sync/harness-installer", async (request, reply) => {
    const q = request.query as { userId?: string };
    const userId = typeof q.userId === "string" ? q.userId : "chrome-extension";
    const entry = getPublishedHarness(userId);
    if (!entry) {
      return reply.code(404).send({ error: "no_harness", message: "No harness installer published for this user yet." });
    }
    const inm = request.headers["if-none-match"];
    if (inm && inm === entry.etag) return reply.code(304).send();
    reply.header("ETag", entry.etag);
    return reply.send({
      userId: entry.userId,
      updatedAt: entry.updatedAt,
      harness: entry.harness,
    });
  });

  app.post("/v1/sync/harness-installer", async (request, reply) => {
    const body = (request.body ?? {}) as { userId?: string; harness?: unknown };
    const userId = typeof body.userId === "string" && body.userId.trim() ? body.userId.trim() : "chrome-extension";
    const spec = normalizeHarnessInput(body.harness);
    if (!spec) {
      return reply.code(400).send({
        error: "invalid_harness",
        message: "Body must include harness with generatedAt and sites array (or legacy harness.sites).",
      });
    }
    const entry = publishHarnessInstaller(userId, spec);
    return reply.send({ ok: true, userId: entry.userId, updatedAt: entry.updatedAt, etag: entry.etag });
  });
}
