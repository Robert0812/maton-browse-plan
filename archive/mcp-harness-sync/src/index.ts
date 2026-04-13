#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const base = (process.env.SKILL_FACTORY_API_BASE ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const userId = process.env.HARNESS_SYNC_USER_ID ?? "chrome-extension";

async function fetchHarness(): Promise<Response> {
  return fetch(`${base}/v1/sync/harness-installer?userId=${encodeURIComponent(userId)}`);
}

function formatForAgent(data: { harness: unknown; updatedAt: string; userId: string }): string {
  const h = data.harness as Record<string, unknown>;
  const sites = h.sites ?? [];
  const cron = h.cronSuggestions ?? [];
  return [
    `# Harness installer (Skill Factory)`,
    `updatedAt: ${data.updatedAt}`,
    `userId: ${data.userId}`,
    `generatedAt: ${String(h.generatedAt ?? "")}`,
    "",
    "## sites (setupSteps + plans)",
    JSON.stringify(sites, null, 2),
    "",
    "## cronSuggestions",
    JSON.stringify(cron, null, 2),
    "",
    "Apply cron from cronSuggestions; follow setupSteps and plans under sites.",
  ].join("\n");
}

const server = new McpServer(
  { name: "wondersagent-harness-sync", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.registerTool(
  "pull_latest_harness_installer",
  {
    description:
      "Returns the latest harness installer published by Skill Factory (Phase 4). Payload is only sites (per-origin setup + function plans) and cronSuggestions. " +
      "Poll after browsing/harness updates; compare updatedAt to avoid redundant re-application. " +
      `Env: SKILL_FACTORY_API_BASE (default ${base}), HARNESS_SYNC_USER_ID (default ${userId}).`,
  },
  async () => {
    const r = await fetchHarness();
    if (r.status === 404) {
      return {
        content: [
          {
            type: "text" as const,
            text:
              "No harness published yet. Extension: open Review → Send to Skill Factory with “full pipeline” checked; API must have LLM keys (Phase 4).",
          },
        ],
      };
    }
    if (!r.ok) {
      const t = await r.text();
      return {
        content: [{ type: "text" as const, text: `HTTP ${r.status}: ${t.slice(0, 600)}` }],
      };
    }
    const data = (await r.json()) as { harness: unknown; updatedAt: string; userId: string };
    const etag = r.headers.get("etag") ?? "";
    const body = formatForAgent(data);
    return {
      content: [
        {
          type: "text" as const,
          text: `ETag: ${etag}\n\n${body}`,
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
