#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

/** Living Skill host: stable tool names while backend swaps P0/P1/P2 handlers remotely. */
const server = new McpServer(
  { name: "wondersagent-skill-host", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.registerTool(
  "skill_factory_placeholder",
  {
    description:
      "Placeholder tool. Replace with tools loaded from Skill Factory bundle (golden path execution).",
  },
  async () => ({
    content: [
      {
        type: "text",
        text: "MCP host is running. Connect Phase 5 export to register dynamic tools per bundle.",
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
