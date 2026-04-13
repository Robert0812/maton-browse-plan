import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerPipelineRoutes } from "./routes/pipeline.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerHarnessSyncRoutes } from "./routes/harness-sync.js";
import { describeOpenAiKeySource, loadOpenAiCompatConfig } from "./config/load-openai-config.js";

const app = Fastify({ logger: true });

/* Chrome (and other browsers) may send Access-Control-Request-Private-Network on preflight when
   chrome-extension:// pages call http://127.0.0.1 — without this, fetch fails with "Failed to fetch". */
app.addHook("onRequest", async (request, reply) => {
  if (
    request.method === "OPTIONS" &&
    request.headers["access-control-request-private-network"] === "true"
  ) {
    reply.header("Access-Control-Allow-Private-Network", "true");
  }
});

await app.register(cors, {
  origin: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

app.get("/", async () => ({
  service: "skill-factory-api",
  about:
    "This is an API, not a web UI. Imported trace rows are not listed here. When you click “Send to Skill Factory” in the extension review page, the server logs the first 3 normalized rows in the terminal running this process (look for [phase:capture]).",
  get: {
    health: "/health",
    pipelinePhases: "/v1/pipeline",
    latestHarness: "/v1/sync/harness-installer?userId=chrome-extension",
  },
  post: { capture: "/v1/pipeline/capture", publishHarness: "/v1/sync/harness-installer" },
}));

await registerHealthRoutes(app);
await registerHarnessSyncRoutes(app);
await registerPipelineRoutes(app);

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

try {
  await app.listen({ port, host });
  app.log.info(`Skill Factory API listening on http://${host}:${port}`);
  const oa = loadOpenAiCompatConfig();
  app.log.info(
    {
      phase4OpenAiKeySource: describeOpenAiKeySource(oa.source),
      phase4OpenAiBaseUrl: oa.baseUrl,
      phase4HasOpenAiKey: Boolean(oa.apiKey),
    },
    "Phase 4 LLM: which credential source is active (Downloads > api.md > env)",
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
